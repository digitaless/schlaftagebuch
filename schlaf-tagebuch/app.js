/* ==========================================================================
   Schlaftagebuch – Application logic
   Fully local: all data lives in the browser's localStorage.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Constants & state
   -------------------------------------------------------------------------- */

const ENTRIES_STORAGE_KEY = "schlaftagebuch.entries.v1";
const SETTINGS_STORAGE_KEY = "schlaftagebuch.settings.v1";

const DEFAULT_SETTINGS = { start: "23:00", end: "07:00" };
const MAX_NOTE_LENGTH = 500;

// Labels for the 1–5 star rating (index = number of stars)
const QUALITY_LABELS = ["", "gar nicht", "wenig", "mittelmäßig", "ziemlich", "sehr"];

// How many nights the statistics view covers
const STATS_NIGHT_COUNT = 7;

function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidSettings(value) {
  return (
    value &&
    typeof value === "object" &&
    isValidTime(value.start) &&
    isValidTime(value.end) &&
    value.start !== value.end
  );
}

function validateEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isValidDate(value.date) || !isValidTime(value.bed) || !isValidTime(value.wake)) {
    return null;
  }
  if (!Number.isInteger(value.quality) || value.quality < 1 || value.quality > 5) return null;

  const total = getDurationMinutes(value.bed, value.wake);
  const awake = value.awake == null ? 0 : Number(value.awake);
  const nap = value.nap == null ? 0 : Number(value.nap);
  if (
    !Number.isInteger(awake) ||
    awake < 0 ||
    awake > total ||
    awake % 5 !== 0 ||
    !Number.isInteger(nap) ||
    nap < 0 ||
    nap % 5 !== 0
  ) {
    return null;
  }

  const windowStart = value.windowStart == null ? DEFAULT_SETTINGS.start : value.windowStart;
  const windowEnd = value.windowEnd == null ? DEFAULT_SETTINGS.end : value.windowEnd;
  if (!isValidTime(windowStart) || !isValidTime(windowEnd)) return null;
  if (value.notes != null && typeof value.notes !== "string") return null;
  const notes = value.notes || "";
  if (notes.length > MAX_NOTE_LENGTH) return null;

  return {
    date: value.date,
    windowStart,
    windowEnd,
    bed: value.bed,
    wake: value.wake,
    total,
    effective: Math.max(0, total - awake),
    awake,
    nap,
    quality: value.quality,
    notes,
  };
}

function readStoredJSON(key, fallback, validator, description) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    if (!validator(value)) throw new Error("Ungültiges Datenformat");
    return value;
  } catch (error) {
    alert(
      `${description} konnten nicht gelesen werden. Es werden vorläufig Standardwerte verwendet. ` +
        `Bitte prüfe den lokalen Speicher. (${error.message})`
    );
    return fallback;
  }
}

function validateEntries(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => validateEntry(entry) !== null) &&
    new Set(value.map((entry) => entry.date)).size === value.length
  );
}

// Saved diary entries, newest first. Each entry looks like:
// { date, windowStart, windowEnd, bed, wake, total, effective, awake, nap, quality, notes }
let entries = readStoredJSON(ENTRIES_STORAGE_KEY, [], validateEntries, "Einträge");

// Default sleep window used to pre-fill new entries
let settings = readStoredJSON(
  SETTINGS_STORAGE_KEY,
  { ...DEFAULT_SETTINGS },
  isValidSettings,
  "Einstellungen"
);

// Currently selected star rating (0 = none chosen yet)
let selectedQuality = 0;

// Date of the entry being edited, or null when creating a new one
let editingDate = null;

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */

const byId = (id) => document.getElementById(id);

// Frequently used elements
const dom = {
  // Today form
  savedNotice: byId("savedNotice"),
  todayTitle: byId("todayTitle"),
  date: byId("date"),
  bedTime: byId("bed"),
  wakeTime: byId("wake"),
  awakeMinutes: byId("awake"),
  sleepDurationOutput: byId("sleepCalc"),
  effectiveDurationOutput: byId("effectiveCalc"),
  napSelect: byId("nap"),
  napMinutes: byId("napMin"),
  qualityText: byId("qualityText"),
  notes: byId("notes"),
  saveButton: byId("save"),

  // History / stats
  historyList: byId("historyList"),
  statCards: byId("statCards"),
  chart: byId("chart"),

  // Settings
  defaultStart: byId("defaultStart"),
  defaultEnd: byId("defaultEnd"),
  saveSettingsButton: byId("saveSettings"),
  exportButton: byId("export"),
  exportPdfButton: byId("exportPdf"),
  importButton: byId("import"),
  clearButton: byId("clear"),
  importDialog: byId("importDialog"),
  importFile: byId("importFile"),
  importJsonButton: byId("importJson"),
  importRawData: byId("importRawData"),
  restoreRawButton: byId("restoreRaw"),
  cancelImportButton: byId("cancelImport"),
  printReport: byId("printReport"),
};

/* --------------------------------------------------------------------------
   Time & formatting helpers
   -------------------------------------------------------------------------- */

/** Formats a local calendar date as "YYYY-MM-DD". */
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Previous night as a local calendar date, without UTC conversion. */
function getPreviousNightISO() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatLocalDate(date);
}

function renderWindowInfo() {
  byId("windowInfo").textContent =
    `Dein festgelegtes Schlaffenster: ${settings.start}–${settings.end} Uhr. ` +
    "Änderungen kannst du unter Einstellungen vornehmen.";
}

/** Converts "HH:MM" to minutes since midnight. Returns null for empty input. */
function timeToMinutes(timeString) {
  if (!timeString) return null;
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Minutes between two "HH:MM" times. If the end is earlier than the start
 * the span crosses midnight (e.g. 23:00 → 07:00 = 480 min).
 * Returns null if either time is missing.
 */
function getDurationMinutes(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null) return null;

  let duration = endMinutes - startMinutes;
  if (duration < 0) duration += 24 * 60;
  return duration;
}

/** Formats minutes as "7 h 05 min". Shows "–" for missing values. */
function formatMinutes(totalMinutes) {
  if (totalMinutes == null || isNaN(totalMinutes)) return "–";
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours} h ${String(remainingMinutes).padStart(2, "0")} min`;
}

/** Text label for a star rating, or the placeholder if none is selected. */
function getQualityLabel(quality) {
  return QUALITY_LABELS[quality] || "Bitte auswählen";
}

/** Escapes user text before inserting it into HTML. */
function escapeHtml(text) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => replacements[char]);
}

/** Average of a numeric property across a list of entries. */
function averageOf(list, property) {
  const sum = list.reduce((total, entry) => total + (Number(entry[property]) || 0), 0);
  return sum / list.length;
}

/* --------------------------------------------------------------------------
   Persistence
   -------------------------------------------------------------------------- */

function saveEntries(nextEntries = entries) {
  try {
    localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
    entries = nextEntries;
    return true;
  } catch (error) {
    alert(`Einträge konnten nicht gespeichert werden. Bitte prüfe den verfügbaren Speicherplatz. (${error.message})`);
    return false;
  }
}

function saveSettings(nextSettings = settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    settings = nextSettings;
    return true;
  } catch (error) {
    alert(`Einstellungen konnten nicht gespeichert werden. (${error.message})`);
    return false;
  }
}

/* --------------------------------------------------------------------------
   Entry form (view: "Heute")
   -------------------------------------------------------------------------- */

/** Recalculates and displays total and effective sleep duration. */
function updateCalculatedDurations() {
  const totalMinutes = getDurationMinutes(dom.bedTime.value, dom.wakeTime.value);
  const awakeMinutes = Number(dom.awakeMinutes.value || 0);

  dom.sleepDurationOutput.textContent = formatMinutes(totalMinutes);

  const effectiveMinutes =
    totalMinutes == null ? null : Math.max(0, totalMinutes - awakeMinutes);
  dom.effectiveDurationOutput.textContent = formatMinutes(effectiveMinutes);
}

/** Highlights the selected stars and updates the text label below them. */
function renderStars() {
  document.querySelectorAll(".star").forEach((starButton) => {
    const starValue = Number(starButton.dataset.value);
    starButton.classList.toggle("on", starValue <= selectedQuality);
  });
  dom.qualityText.textContent = selectedQuality
    ? getQualityLabel(selectedQuality)
    : "Bitte auswählen";
}

/** Clears the form and pre-fills the date of the previous night. */
function resetForm(date = getPreviousNightISO()) {
  editingDate = null;

  dom.date.value = date;

  dom.bedTime.value = "";
  dom.wakeTime.value = "";
  dom.awakeMinutes.value = "";

  dom.napSelect.value = "0";
  dom.napMinutes.value = 0;
  dom.napMinutes.disabled = true;

  dom.notes.value = "";
  selectedQuality = 0;

  renderStars();
  updateCalculatedDurations();
  dom.todayTitle.textContent = "Schlaf von letzter Nacht";
}

/** Fills the form with an existing entry so it can be edited. */
function loadEntryIntoForm(entry) {
  editingDate = entry.date;

  dom.date.value = entry.date;
  dom.bedTime.value = entry.bed;
  dom.wakeTime.value = entry.wake;
  dom.awakeMinutes.value = entry.awake || 0;

  dom.napSelect.value = entry.nap > 0 ? "1" : "0";
  dom.napMinutes.value = entry.nap || 0;
  dom.napMinutes.disabled = entry.nap <= 0;

  dom.notes.value = entry.notes || "";
  selectedQuality = entry.quality || 0;

  renderStars();
  updateCalculatedDurations();
  dom.todayTitle.textContent = "Eintrag bearbeiten";
  switchView("today");
}

/** Validates the form, then adds or replaces the entry for the chosen date. */
function handleSaveEntry() {
  const date = dom.date.value;
  const bed = dom.bedTime.value;
  const wake = dom.wakeTime.value;
  if (!isValidDate(date)) {
    alert("Bitte ein gültiges Datum auswählen.");
    return;
  }
  if (!isValidTime(bed) || !isValidTime(wake)) {
    alert("Bitte gültige Bett- und Aufstehzeiten eingeben.");
    return;
  }

  const totalMinutes = getDurationMinutes(bed, wake);
  const awakeMinutes = dom.awakeMinutes.value === "" ? 0 : Number(dom.awakeMinutes.value);
  const napMinutes = dom.napSelect.value === "1"
    ? (dom.napMinutes.value === "" ? 0 : Number(dom.napMinutes.value))
    : 0;
  if (totalMinutes <= 0) {
    alert("Bett- und Aufstehzeit dürfen nicht identisch sein.");
    return;
  }
  if (
    !Number.isInteger(awakeMinutes) ||
    awakeMinutes < 0 ||
    awakeMinutes > totalMinutes ||
    awakeMinutes % 5 !== 0
  ) {
    alert("Die Wachzeit muss eine Zahl in 5-Minuten-Schritten zwischen 0 und der gesamten Schlafdauer sein.");
    return;
  }
  if (!Number.isInteger(napMinutes) || napMinutes < 0 || napMinutes % 5 !== 0) {
    alert("Der Tagesschlaf muss eine nicht-negative Zahl in 5-Minuten-Schritten sein.");
    return;
  }
  if (!Number.isInteger(selectedQuality) || selectedQuality < 1 || selectedQuality > 5) {
    alert("Bitte eine Schlafqualität zwischen 1 und 5 Sternen auswählen.");
    return;
  }
  if (dom.notes.value.length > MAX_NOTE_LENGTH) {
    alert(`Notizen dürfen höchstens ${MAX_NOTE_LENGTH} Zeichen enthalten.`);
    return;
  }

  const targetEntry = entries.find((entry) => entry.date === date);
  if (targetEntry && date !== editingDate) {
    alert("Für dieses Datum gibt es bereits einen Eintrag. Bitte wähle ein anderes Datum.");
    return;
  }
  const existingEntry = entries.find((entry) => entry.date === editingDate);

  const entry = {
    date,
    windowStart: existingEntry?.windowStart || settings.start,
    windowEnd: existingEntry?.windowEnd || settings.end,
    bed,
    wake,
    total: totalMinutes,
    effective: Math.max(0, totalMinutes - awakeMinutes),
    awake: awakeMinutes,
    nap: napMinutes,
    quality: selectedQuality,
    notes: dom.notes.value,
  };

  const updatedEntries = entries.filter(
    (existing) => existing.date !== editingDate && existing.date !== date
  );
  updatedEntries.push(entry);
  updatedEntries.sort((a, b) => b.date.localeCompare(a.date));
  if (!saveEntries(updatedEntries)) return;

  // Brief confirmation banner
  dom.savedNotice.style.display = "block";
  setTimeout(() => (dom.savedNotice.style.display = "none"), 2200);

  renderHistory();
  renderStats();
  resetForm();
}

/* --------------------------------------------------------------------------
   History (view: "Verlauf")
   -------------------------------------------------------------------------- */

/** Builds the HTML for a single history entry. */
function renderHistoryEntry(entry) {
  const dateLabel = new Date(entry.date + "T12:00").toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const stars = "★".repeat(entry.quality) + "☆".repeat(5 - entry.quality);
  const notesSuffix = entry.notes ? " · " + escapeHtml(entry.notes) : "";

  // Buttons carry the entry date in data-date; clicks are handled via delegation
  return `
    <div class="entry">
      <div class="entry-head">
        <div>
          <b>${dateLabel}</b>
          <div class="badge">${entry.bed} – ${entry.wake}</div>
        </div>
        <div>
          <b>${formatMinutes(entry.effective)}</b>
          <div class="badge">${stars}</div>
        </div>
      </div>
      <div class="small">Wach: ${entry.awake} min · Tagesschlaf: ${entry.nap} min${notesSuffix}</div>
      <br>
      <button class="secondary" data-action="edit" data-date="${entry.date}">Bearbeiten</button>
      <button class="secondary danger" data-action="delete" data-date="${entry.date}">Löschen</button>
    </div>`;
}

function renderHistory() {
  if (!entries.length) {
    dom.historyList.innerHTML = '<div class="empty">Noch keine Einträge vorhanden.</div>';
    return;
  }
  dom.historyList.innerHTML = entries.map(renderHistoryEntry).join("");
}

function deleteEntry(date) {
  if (!confirm("Diesen Eintrag löschen?")) return;

  const updatedEntries = entries.filter((entry) => entry.date !== date);
  if (!saveEntries(updatedEntries)) return;
  renderHistory();
  renderStats();
}

/** Handles "Bearbeiten" / "Löschen" clicks inside the history list. */
function handleHistoryClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const date = button.dataset.date;
  if (button.dataset.action === "edit") {
    const entry = entries.find((e) => e.date === date);
    if (entry) loadEntryIntoForm(entry);
  } else if (button.dataset.action === "delete") {
    deleteEntry(date);
  }
}

/* --------------------------------------------------------------------------
   Statistics (view: "Statistik")
   -------------------------------------------------------------------------- */

function renderStats() {
  const recentNights = entries.slice(0, STATS_NIGHT_COUNT);

  if (!recentNights.length) {
    dom.statCards.innerHTML =
      '<div class="empty" style="grid-column:1/-1">Noch keine Daten.</div>';
    dom.chart.innerHTML = "";
    return;
  }

  // Summary tiles
  dom.statCards.innerHTML = `
    <div class="stat"><span class="small">Ø Schlaf</span><b>${formatMinutes(Math.round(averageOf(recentNights, "effective")))}</b></div>
    <div class="stat"><span class="small">Ø Qualität</span><b>${averageOf(recentNights, "quality").toFixed(1)} / 5</b></div>
    <div class="stat"><span class="small">Ø Wachzeit</span><b>${Math.round(averageOf(recentNights, "awake"))} min</b></div>
    <div class="stat"><span class="small">Nächte</span><b>${recentNights.length}</b></div>`;

  // Bar chart, oldest night on the left. Scale is at least 8 h so short
  // nights don't look full-height.
  const chronological = recentNights.slice().reverse();
  const maxMinutes = Math.max(...recentNights.map((e) => e.effective), 480);
  const MAX_BAR_HEIGHT_PX = 150;

  const barsHtml = chronological
    .map((entry) => {
      const heightPx = Math.max(2, (entry.effective / maxMinutes) * MAX_BAR_HEIGHT_PX);
      return `<div class="bar" style="height:${heightPx}px"><span>${formatMinutes(entry.effective)}</span></div>`;
    })
    .join("");

  // Axis labels as "DD.MM"
  const labelsHtml = chronological
    .map((entry) => `<div>${entry.date.slice(8, 10)}.${entry.date.slice(5, 7)}</div>`)
    .join("");

  dom.chart.innerHTML = `<div class="bar-wrap">${barsHtml}</div><div class="bar-labels">${labelsHtml}</div>`;
}

/* --------------------------------------------------------------------------
   Settings (view: "Einstellungen")
   -------------------------------------------------------------------------- */

function formatReportDate(dateString) {
  if (!dateString || !isValidDate(dateString)) return "–";
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatReportDateRange(entryList) {
  if (!entryList.length) return "Keine Einträge";
  const sorted = [...entryList].sort((a, b) => a.date.localeCompare(b.date));
  return `${formatReportDate(sorted[0].date)} – ${formatReportDate(sorted[sorted.length - 1].date)}`;
}

function renderPrintReport() {
  const reportEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const totalNights = reportEntries.length;
  const avgSleep = totalNights ? formatMinutes(Math.round(averageOf(reportEntries, "effective"))) : "–";
  const avgAwake = totalNights ? `${Math.round(averageOf(reportEntries, "awake"))} min` : "–";
  const avgQuality = totalNights ? `${averageOf(reportEntries, "quality").toFixed(1)} / 5` : "–";
  const exportDate = new Date().toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const rowsHtml = reportEntries.length
    ? reportEntries
        .map((entry) => {
          const qualityText = `${"★".repeat(entry.quality)}${"☆".repeat(5 - entry.quality)} · ${getQualityLabel(entry.quality)}`;
          const noteText = entry.notes ? escapeHtml(entry.notes) : "—";
          return `
            <tr>
              <td>${formatReportDate(entry.date)}</td>
              <td>${entry.bed}</td>
              <td>nicht erfasst</td>
              <td>${entry.awake} min</td>
              <td>${entry.wake}</td>
              <td>${formatMinutes(entry.effective)}</td>
              <td>
                <div class="report-quality">${qualityText}</div>
                <div class="report-notes">${noteText}</div>
              </td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="empty-report">Noch keine Einträge vorhanden.</td></tr>`;

  dom.printReport.innerHTML = `
    <div class="print-report__document">
      <header class="print-report__header">
        <div>
          <div class="print-report__eyebrow">Schlaf- und Erholungsübersicht</div>
          <h1>Schlaftagebuch – Auswertung</h1>
        </div>
        <div class="print-report__meta">
          <div><strong>Zeitraum:</strong> ${formatReportDateRange(reportEntries)}</div>
          <div><strong>Erstellt am:</strong> ${exportDate}</div>
          <div><strong>Festgelegtes Schlaffenster:</strong> ${settings.start} – ${settings.end} Uhr</div>
        </div>
      </header>

      <section class="print-report__summary">
        <div class="report-card">
          <span>Ø Schlafdauer</span>
          <strong>${avgSleep}</strong>
        </div>
        <div class="report-card">
          <span>Ø Einschlafzeit</span>
          <strong>nicht erfasst</strong>
        </div>
        <div class="report-card">
          <span>Ø Wachzeit</span>
          <strong>${avgAwake}</strong>
        </div>
        <div class="report-card">
          <span>Erfasste Nächte</span>
          <strong>${totalNights}</strong>
        </div>
      </section>

      <section class="print-report__section">
        <h2>Einzelne Nächte</h2>
        <table class="report-table">
          <thead>
            <tr>
              <th>Datum / Nacht</th>
              <th>Ins Bett gegangen</th>
              <th>Eingeschlafen</th>
              <th>Aufgewacht</th>
              <th>Aufgestanden</th>
              <th>Gesamte Schlafdauer</th>
              <th>Schlafqualität / Befinden &amp; Notizen</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>
    </div>`;
}

function handleExportPdf() {
  renderPrintReport();
  if (window && typeof window.print === "function") {
    window.print();
  }
}

function handleSaveSettings() {
  const nextSettings = {
    start: dom.defaultStart.value,
    end: dom.defaultEnd.value,
  };
  if (!isValidSettings(nextSettings)) {
    alert("Bitte gültige, unterschiedliche Start- und Endzeiten für das Schlaffenster eingeben.");
    return;
  }
  if (!saveSettings(nextSettings)) return;
  renderWindowInfo();
  alert("Einstellungen gespeichert.");
  resetForm();
}

/** Downloads settings and entries as a JSON file. */
function handleExport() {
  const json = JSON.stringify({ settings, entries }, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "schlaftagebuch-export.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseImportData(rawData) {
  const parsed = JSON.parse(rawData);
  const payload = Array.isArray(parsed)
    ? { entries: parsed, settings }
    : parsed;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entries)) {
    throw new Error("Erwartet wird ein Export mit einer Eintragsliste oder eine reine Eintragsliste.");
  }

  const importedEntries = payload.entries.map(validateEntry);
  if (importedEntries.some((entry) => entry === null)) {
    throw new Error("Mindestens ein Eintrag enthält ungültige oder unvollständige Daten.");
  }
  if (new Set(importedEntries.map((entry) => entry.date)).size !== importedEntries.length) {
    throw new Error("Die Sicherung enthält mehrere Einträge mit demselben Datum.");
  }

  const importedSettings = payload.settings == null ? settings : payload.settings;
  if (!isValidSettings(importedSettings)) {
    throw new Error("Die Einstellungen in der Sicherung sind ungültig.");
  }
  importedEntries.sort((a, b) => b.date.localeCompare(a.date));
  return { entries: importedEntries, settings: { ...importedSettings } };
}

function replaceWithImportedData(importedData) {
  if (entries.length || settings.start !== DEFAULT_SETTINGS.start || settings.end !== DEFAULT_SETTINGS.end) {
    if (!confirm("Der Import ersetzt alle aktuell gespeicherten Einträge und Einstellungen. Fortfahren?")) {
      return;
    }
  }

  let previousEntries;
  let previousSettings;
  try {
    previousSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    previousEntries = localStorage.getItem(ENTRIES_STORAGE_KEY);
  } catch (error) {
    alert(`Der lokale Speicher konnte nicht gelesen werden. Import abgebrochen. (${error.message})`);
    return;
  }

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(importedData.settings));
    localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(importedData.entries));
  } catch (error) {
    try {
      if (previousSettings == null) localStorage.removeItem(SETTINGS_STORAGE_KEY);
      else localStorage.setItem(SETTINGS_STORAGE_KEY, previousSettings);
      if (previousEntries == null) localStorage.removeItem(ENTRIES_STORAGE_KEY);
      else localStorage.setItem(ENTRIES_STORAGE_KEY, previousEntries);
    } catch (rollbackError) {
      alert(`Import fehlgeschlagen und die vorherigen Daten konnten nicht vollständig wiederhergestellt werden. (${error.message}; ${rollbackError.message})`);
      return;
    }
    alert(`Import fehlgeschlagen. Die bisherigen Daten wurden beibehalten. (${error.message})`);
    return;
  }

  entries = importedData.entries;
  settings = importedData.settings;
  dom.defaultStart.value = settings.start;
  dom.defaultEnd.value = settings.end;
  renderWindowInfo();
  renderHistory();
  renderStats();
  dom.importDialog.close();
  dom.importRawData.value = "";
  dom.importFile.value = "";
  alert("Daten wurden erfolgreich wiederhergestellt.");
}

function handleImportText(rawData) {
  try {
    replaceWithImportedData(parseImportData(rawData));
  } catch (error) {
    alert(`Import nicht möglich: ${error.message}`);
  }
}

async function handleImportFile() {
  const file = dom.importFile.files && dom.importFile.files[0];
  if (!file) {
    alert("Bitte zuerst eine JSON-Datei auswählen.");
    return;
  }
  try {
    handleImportText(await file.text());
  } catch (error) {
    alert(`Die JSON-Datei konnte nicht gelesen werden. (${error.message})`);
  }
}

function handleRestoreRawData() {
  if (!dom.importRawData.value.trim()) {
    alert("Bitte zuerst Rohdaten einfügen.");
    return;
  }
  handleImportText(dom.importRawData.value);
}

function handleClearAllData() {
  if (!confirm("Wirklich alle Schlafdaten löschen?")) return;

  try {
    localStorage.removeItem(ENTRIES_STORAGE_KEY);
  } catch (error) {
    alert(`Einträge konnten nicht gelöscht werden. (${error.message})`);
    return;
  }
  entries = [];
  renderHistory();
  renderStats();
}

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */

/** Shows one view, marks its tab active, and refreshes dynamic content. */
function switchView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewName);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });

  if (viewName === "history") renderHistory();
  if (viewName === "stats") renderStats();
}

/* --------------------------------------------------------------------------
   Event wiring
   -------------------------------------------------------------------------- */

function bindEvents() {
  // Live duration calculation
  [dom.bedTime, dom.wakeTime, dom.awakeMinutes].forEach((input) => {
    input.addEventListener("input", updateCalculatedDurations);
  });

  // Nap minutes are only editable when "Ja" is selected
  dom.napSelect.addEventListener("change", () => {
    const hasNap = dom.napSelect.value !== "0";
    dom.napMinutes.disabled = !hasNap;
    if (!hasNap) dom.napMinutes.value = 0;
  });

  // Star rating
  document.querySelectorAll(".star").forEach((starButton) => {
    starButton.addEventListener("click", () => {
      selectedQuality = Number(starButton.dataset.value);
      renderStars();
    });
  });

  dom.saveButton.addEventListener("click", handleSaveEntry);
  dom.historyList.addEventListener("click", handleHistoryClick);

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  // Settings & data
  dom.saveSettingsButton.addEventListener("click", handleSaveSettings);
  dom.exportButton.addEventListener("click", handleExport);
  dom.exportPdfButton.addEventListener("click", handleExportPdf);
  dom.importButton.addEventListener("click", () => dom.importDialog.showModal());
  dom.importJsonButton.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", handleImportFile);
  dom.restoreRawButton.addEventListener("click", handleRestoreRawData);
  dom.cancelImportButton.addEventListener("click", () => dom.importDialog.close());
  dom.clearButton.addEventListener("click", handleClearAllData);
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */

function init() {
  dom.defaultStart.value = settings.start;
  dom.defaultEnd.value = settings.end;
  renderWindowInfo();
  dom.napMinutes.disabled = true;

  bindEvents();
  resetForm();
  renderHistory();
  renderStats();
}

init();
