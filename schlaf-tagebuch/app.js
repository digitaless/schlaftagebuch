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

// Labels for the 1–5 star rating (index = number of stars)
const QUALITY_LABELS = ["", "gar nicht", "wenig", "mittelmäßig", "ziemlich", "sehr"];

// How many nights the statistics view covers
const STATS_NIGHT_COUNT = 7;

// Saved diary entries, newest first. Each entry looks like:
// { date, windowStart, windowEnd, bed, wake, total, effective, awake, nap, quality, notes }
let entries = JSON.parse(localStorage.getItem(ENTRIES_STORAGE_KEY) || "[]");

// Default sleep window used to pre-fill new entries
let settings = JSON.parse(
  localStorage.getItem(SETTINGS_STORAGE_KEY) || JSON.stringify(DEFAULT_SETTINGS)
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
  clearButton: byId("clear"),
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

function saveEntries() {
  localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
  if (!dom.bedTime.value || !dom.wakeTime.value) {
    alert("Bitte Bettzeit und Aufstehzeit eingeben.");
    return;
  }
  if (!selectedQuality) {
    alert("Bitte Schlafqualität auswählen.");
    return;
  }

  const date = dom.date.value || getPreviousNightISO();
  const existingEntry =
    entries.find((entry) => entry.date === date) ||
    entries.find((entry) => entry.date === editingDate);
  const totalMinutes = getDurationMinutes(dom.bedTime.value, dom.wakeTime.value);
  const awakeMinutes = Number(dom.awakeMinutes.value || 0);
  const napMinutes =
    dom.napSelect.value === "1" ? Number(dom.napMinutes.value || 0) : 0;

  const entry = {
    date,
    windowStart: existingEntry?.windowStart || settings.start,
    windowEnd: existingEntry?.windowEnd || settings.end,
    bed: dom.bedTime.value,
    wake: dom.wakeTime.value,
    total: totalMinutes,
    effective: Math.max(0, totalMinutes - awakeMinutes),
    awake: awakeMinutes,
    nap: napMinutes,
    quality: selectedQuality,
    notes: dom.notes.value,
  };

  // One entry per date: replace if it exists, otherwise append
  const existingIndex = entries.findIndex((e) => e.date === date);
  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }

  // Keep newest first
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveEntries();

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

  entries = entries.filter((entry) => entry.date !== date);
  saveEntries();
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

function handleSaveSettings() {
  settings = {
    start: dom.defaultStart.value,
    end: dom.defaultEnd.value,
  };
  saveSettings();
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

function handleClearAllData() {
  if (!confirm("Wirklich alle Schlafdaten löschen?")) return;

  entries = [];
  localStorage.removeItem(ENTRIES_STORAGE_KEY);
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
