import "./styles.css";
import {
  formatDate,
  formatNumber,
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  translate,
} from "./i18n.js";
import {
  DEFAULT_SETTINGS,
  formatMinutes,
  getRollingSleepPeriod,
  getSleepChartData,
  getDurationMinutes,
  getQualityLabel,
  isValidDate,
  isValidSettings,
  isValidTime,
  MAX_NOTE_LENGTH,
  STATS_DAY_COUNT,
  validateEntries,
  validateEntry,
} from "./sleep-data.js";

/* ==========================================================================
   Schlaftagebuch – Application logic
   Fully local: all data lives in the browser's localStorage.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Constants & state
   -------------------------------------------------------------------------- */

const ENTRIES_STORAGE_KEY = "schlaftagebuch.entries.v1";
const SETTINGS_STORAGE_KEY = "schlaftagebuch.settings.v1";
const WELCOME_DISMISSED_STORAGE_KEY = "schlaftagebuch.welcome.dismissed.v1";
const LANGUAGE_STORAGE_KEY = "schlaftagebuch.language.v1";

function readLanguage() {
  try {
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(storedLanguage) ? storedLanguage : "de";
  } catch (error) {
    alert(translate("de", "error.languageRead", { error: error.message }));
    return "de";
  }
}

let language = readLanguage();
const t = (key, params) => translate(language, key, params);

const SHEEP_COUNT = 10;
const SHEEP_MESSAGE_COUNT = 11;
const SHEEP_STEP_MS = 4000;
function readStoredJSON(key, fallback, validator, description) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    if (!validator(value)) throw new Error(t("error.invalidStoredData"));
    return value;
  } catch (error) {
    alert(
      t("error.storageRead", { description: t(description), error: error.message })
    );
    return fallback;
  }
}

// Saved diary entries, newest first. Each entry looks like:
// { date, windowStart, windowEnd, bed, wake, total, effective, awake, nap, quality, notes, medication, medicationName }
let entries = readStoredJSON(ENTRIES_STORAGE_KEY, [], validateEntries, "error.entries")
  .map(validateEntry)
  .sort((a, b) => b.date.localeCompare(a.date));

// Default sleep window used to pre-fill new entries
let settings = readStoredJSON(
  SETTINGS_STORAGE_KEY,
  { ...DEFAULT_SETTINGS },
  isValidSettings,
  "error.settings"
);

// Currently selected star rating (0 = none chosen yet)
let selectedQuality = 0;

// Date of the entry being edited, or null when creating a new one
let editingDate = null;
let sheepCount = 0;
let sheepAnimationEndHandler = null;
let sheepReducedMotionTimeout = null;
let sheepKeydownHandler = null;
let sheepReturnFocus = null;
let settingsSavedTimeout = null;
let morningSheepTimeout = null;
let morningSheepReturnFocus = null;
let morningSheepKeydownHandler = null;

const MORNING_SHEEP_PHASES = [
  { state: "sleeping", delay: 3000 },
  { state: "waking", delay: 3000 },
  { state: "sitting", delay: 3400 },
  { state: "flopping", delay: 3000 },
  { state: "negotiating", delay: 3400 },
  { state: "standing", delay: 3300 },
  { state: "ready", delay: 0 },
];
const MORNING_SHEEP_REDUCED_MOTION_DELAY_MS = 1800;
const MORNING_SHEEP_STATES = MORNING_SHEEP_PHASES.map(({ state }) => state);
let morningSheepPhase = 0;
let sheepFinaleMessageIndex = 0;

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
  medicationSelect: byId("medication"),
  medicationNameField: byId("medicationNameField"),
  medicationName: byId("medicationName"),
  countSheepButton: byId("countSheep"),
  sheepDialog: byId("sheepDialog"),
  closeSheepButton: byId("closeSheep"),
  restartSheepButton: byId("restartSheep"),
  sheepTrack: byId("sheepTrack"),
  sheepCounter: byId("sheepCounter"),
  sheepFinale: byId("sheepFinale"),
  wakeSheepButton: byId("wakeSheep"),
  morningSheepDialog: byId("morningSheepDialog"),
  closeMorningSheepButton: byId("closeMorningSheep"),
  restartMorningSheepButton: byId("restartMorningSheep"),
  doneMorningSheepButton: byId("doneMorningSheep"),
  morningScene: byId("morningScene"),
  morningMessage: byId("morningMessage"),
  morningFinale: byId("morningFinale"),
  qualityText: byId("qualityText"),
  notes: byId("notes"),
  saveButton: byId("save"),

  // History / stats
  historyList: byId("historyList"),
  statCards: byId("statCards"),
  chart: byId("chart"),
  statsExportPdfButton: byId("statsExportPdf"),

  // Settings
  defaultStart: byId("defaultStart"),
  defaultEnd: byId("defaultEnd"),
  languageSelect: byId("language"),
  settingsSavedNotice: byId("settingsSavedNotice"),
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
  welcomeDialog: byId("welcomeDialog"),
  welcomeDismissCheckbox: byId("welcomeDismissCheckbox"),
  closeWelcomeButton: byId("closeWelcome"),
  welcomeStartButton: byId("welcomeStart"),
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

function applyStaticTranslations() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-content]").forEach((element) => {
    element.setAttribute("content", t(element.dataset.i18nContent));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-aria-label-param]").forEach((element) => {
    element.setAttribute(
      "aria-label",
      t(element.dataset.i18nAriaLabelParam, { value: element.dataset.value })
    );
  });
  dom.languageSelect.value = language;
  document.querySelectorAll("#language option").forEach((option) => {
    option.textContent = LANGUAGE_NAMES[option.value] ?? LANGUAGE_NAMES.de;
  });
}

function renderWindowInfo() {
  byId("windowInfo").textContent =
    t("window.info", { start: settings.start, end: settings.end });
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

function renderSleepChart(days, property) {
  const { chronological, maxValue } = getSleepChartData(days, property);
  const MAX_BAR_HEIGHT_PX = 150;
  const barsHtml = chronological
    .map(({ date, value }) => {
      const missing = value == null;
      const heightPx = missing ? 0 : Math.max(2, (value / maxValue) * MAX_BAR_HEIGHT_PX);
      const dateLabel = formatDate(new Date(`${date}T12:00:00`), language, { day: "2-digit" });
      const unit = property === "quality" ? t("stats.qualityUnit") : t("time.minutes");
      const valueLabel = missing ? t("stats.missing") : formatNumber(value, language);
      const accessibleValue = missing ? valueLabel : `${valueLabel} ${unit}`;
      return `<div class="bar${missing ? " bar-missing" : ""}" style="height:${heightPx}px" title="${date}: ${accessibleValue}" aria-label="${date}: ${accessibleValue}"><span>${valueLabel}</span></div>`;
    })
    .join("");
  const labelsHtml = chronological
    .map(({ date }) => `<div title="${formatDate(new Date(`${date}T12:00:00`), language)}">${formatDate(new Date(`${date}T12:00:00`), language, { day: "2-digit" })}</div>`)
    .join("");
  const emptyMessage = chronological.some(({ value }) => Number.isFinite(value))
    ? ""
    : `<p class="small chart-empty">${t("stats.noMeasurements")}</p>`;
  return `${emptyMessage}<div class="bar-wrap">${barsHtml}</div><div class="bar-labels">${labelsHtml}</div>`;
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
    alert(t("error.storageSaveEntries", { error: error.message }));
    return false;
  }
}

function saveSettings(nextSettings = settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    settings = nextSettings;
    return true;
  } catch (error) {
    alert(t("error.storageSaveSettings", { error: error.message }));
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
  const hasValidTotal = totalMinutes != null && totalMinutes > 0;
  const validAwakeMinutes =
    hasValidTotal &&
    Number.isInteger(awakeMinutes) &&
    awakeMinutes >= 0 &&
    awakeMinutes <= totalMinutes &&
    awakeMinutes % 5 === 0;

  dom.sleepDurationOutput.textContent = formatMinutes(hasValidTotal ? totalMinutes : null, language);

  const effectiveMinutes =
    !validAwakeMinutes
      ? null
      : Math.max(0, totalMinutes - awakeMinutes);
  dom.effectiveDurationOutput.textContent = formatMinutes(effectiveMinutes, language);
}

/** Highlights the selected stars and updates the text label below them. */
function renderStars() {
  document.querySelectorAll(".star").forEach((starButton) => {
    const starValue = Number(starButton.dataset.value);
    const isSelected = starValue <= selectedQuality;
    starButton.classList.toggle("on", isSelected);
    starButton.setAttribute("aria-pressed", String(starValue === selectedQuality));
  });
  dom.qualityText.textContent = selectedQuality
    ? getQualityLabel(selectedQuality, language)
    : t("form.qualityNone");
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

  dom.medicationSelect.value = "0";
  dom.medicationName.value = "";
  updateMedicationFields();

  dom.notes.value = "";
  selectedQuality = 0;

  renderStars();
  updateCalculatedDurations();
  dom.todayTitle.textContent = t("today.lastNight");
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

  dom.medicationSelect.value = entry.medication ? "1" : "0";
  dom.medicationName.value = entry.medicationName || "";
  updateMedicationFields();

  dom.notes.value = entry.notes || "";
  selectedQuality = entry.quality || 0;

  renderStars();
  updateCalculatedDurations();
  dom.todayTitle.textContent = t("today.edit");
  switchView("today");
}

function getPreviousDateISO(date) {
  if (!isValidDate(date)) return null;
  const previousDate = new Date(`${date}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return previousDate.toISOString().slice(0, 10);
}

function updateMedicationFields(copyPreviousMedication = false) {
  const hasMedication = dom.medicationSelect.value === "1";
  dom.medicationNameField.hidden = !hasMedication;
  dom.medicationName.required = hasMedication;
  if (!hasMedication) {
    dom.medicationName.value = "";
    return;
  }
  if (copyPreviousMedication && !dom.medicationName.value.trim()) {
    const previousDate = getPreviousDateISO(dom.date.value);
    const previousEntry = entries.find((entry) => entry.date === previousDate);
    if (previousEntry?.medication && previousEntry.medicationName) {
      dom.medicationName.value = previousEntry.medicationName;
    }
  }
}

function createSheepMarkup() {
  return Array.from({ length: SHEEP_COUNT }, (_, index) => `
    <svg class="count-sheep" data-sheep-index="${index}" style="--sheep-index:${index};--sheep-delay:${index * 1.5}s" viewBox="0 0 74 56" aria-hidden="true" focusable="false">
      <ellipse cx="34" cy="34" rx="24" ry="16" fill="#f8fafc"/>
      <circle cx="18" cy="26" r="10" fill="#fff"/>
      <circle cx="30" cy="20" r="11" fill="#fff"/>
      <circle cx="44" cy="21" r="11" fill="#fff"/>
      <circle cx="53" cy="29" r="9" fill="#fff"/>
      <ellipse cx="57" cy="30" rx="9" ry="11" fill="#efd6c2"/>
      <ellipse cx="50" cy="22" rx="4" ry="2.5" fill="#efd6c2" transform="rotate(-28 50 22)"/>
      <circle cx="60" cy="28" r="1.5" fill="#26364f"/>
      <path d="M59 34q3 2 5 0M21 44v8m12-6v6m15-9v9" fill="none" stroke="#d8dce4" stroke-width="3" stroke-linecap="round"/>
    </svg>`).join("");
}

function updateSheepCount() {
  dom.sheepCounter.textContent = t("sheep.counter", { count: formatNumber(sheepCount, language) });
  dom.sheepFinale.hidden = sheepCount < SHEEP_COUNT;
  if (sheepCount >= SHEEP_COUNT) {
    const messageIndex = Math.min(
      Math.floor(sheepCount / SHEEP_COUNT) - 1,
      SHEEP_MESSAGE_COUNT - 1
    );
    sheepFinaleMessageIndex = messageIndex;
    dom.sheepFinale.textContent = t(`sheep.message.${messageIndex}`);
  }
}

function cleanupSheepAnimation() {
  if (sheepAnimationEndHandler) {
    dom.sheepTrack.removeEventListener("animationend", sheepAnimationEndHandler);
    sheepAnimationEndHandler = null;
  }
  if (sheepReducedMotionTimeout !== null) {
    clearTimeout(sheepReducedMotionTimeout);
    sheepReducedMotionTimeout = null;
  }
  dom.sheepTrack.innerHTML = "";
}

function cleanupSheepCounter() {
  cleanupSheepAnimation();
  if (sheepKeydownHandler) {
    document.removeEventListener("keydown", sheepKeydownHandler);
    sheepKeydownHandler = null;
  }
}

function countReducedMotionSheep() {
  sheepReducedMotionTimeout = null;
  const sheep = dom.sheepTrack.querySelectorAll(".count-sheep")[sheepCount % SHEEP_COUNT];
  sheep?.classList.add("is-counted");
  sheepCount += 1;
  updateSheepCount();
  sheepReducedMotionTimeout = setTimeout(countReducedMotionSheep, SHEEP_STEP_MS);
}

function startNextSheepJump() {
  const sheep = dom.sheepTrack.querySelectorAll(".count-sheep")[sheepCount % SHEEP_COUNT];
  sheep?.classList.add("is-jumping");
}

function handleSheepJumpEnd(event) {
  const sheepIndex = Number(event.target.dataset.sheepIndex);
  if (
    !Number.isInteger(sheepIndex) ||
    sheepIndex !== sheepCount % SHEEP_COUNT ||
    !event.target.classList.contains("is-jumping")
  ) {
    return;
  }

  event.target.classList.remove("is-jumping");
  sheepCount += 1;
  updateSheepCount();
  startNextSheepJump();
}

function startSheepCounting() {
  cleanupSheepAnimation();
  sheepCount = 0;
  updateSheepCount();
  dom.sheepTrack.innerHTML = createSheepMarkup();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sheepReducedMotionTimeout = setTimeout(countReducedMotionSheep, SHEEP_STEP_MS);
    return;
  }

  sheepAnimationEndHandler = handleSheepJumpEnd;
  dom.sheepTrack.addEventListener("animationend", sheepAnimationEndHandler);
  startNextSheepJump();
}

function openSheepCounter() {
  sheepReturnFocus = document.activeElement;
  dom.sheepDialog.showModal();
  startSheepCounting();
  sheepKeydownHandler = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dom.sheepDialog.close();
  };
  document.addEventListener("keydown", sheepKeydownHandler);
}

function closeSheepCounter() {
  cleanupSheepCounter();
  sheepReturnFocus?.focus();
  sheepReturnFocus = null;
}

function clearMorningSheepTimeout() {
  if (morningSheepTimeout !== null) {
    clearTimeout(morningSheepTimeout);
    morningSheepTimeout = null;
  }
}

function showMorningSheepPhase(phaseIndex) {
  const phase = MORNING_SHEEP_PHASES[phaseIndex];
  MORNING_SHEEP_STATES.forEach((state) => {
    dom.morningScene.classList.toggle(`morning-scene--${state}`, state === phase.state);
  });
  dom.morningMessage.textContent = t(`morning.phase.${phaseIndex}`);

  if (phase.state === "ready") {
    dom.morningFinale.hidden = false;
    dom.restartMorningSheepButton.hidden = false;
    dom.doneMorningSheepButton.hidden = false;
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  morningSheepTimeout = setTimeout(() => {
    morningSheepTimeout = null;
    morningSheepPhase += 1;
    showMorningSheepPhase(morningSheepPhase);
  }, reducedMotion ? MORNING_SHEEP_REDUCED_MOTION_DELAY_MS : phase.delay);
}

function startMorningSheep() {
  clearMorningSheepTimeout();
  morningSheepPhase = 0;
  dom.morningFinale.hidden = true;
  dom.restartMorningSheepButton.hidden = true;
  dom.doneMorningSheepButton.hidden = true;
  showMorningSheepPhase(morningSheepPhase);
}

function openMorningSheep() {
  morningSheepReturnFocus = document.activeElement;
  dom.morningSheepDialog.showModal();
  dom.closeMorningSheepButton.focus();
  startMorningSheep();
  morningSheepKeydownHandler = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dom.morningSheepDialog.close();
  };
  document.addEventListener("keydown", morningSheepKeydownHandler);
}

function closeMorningSheep() {
  clearMorningSheepTimeout();
  if (morningSheepKeydownHandler) {
    document.removeEventListener("keydown", morningSheepKeydownHandler);
    morningSheepKeydownHandler = null;
  }
  MORNING_SHEEP_STATES.forEach((state) => {
    dom.morningScene.classList.toggle(`morning-scene--${state}`, false);
  });
  dom.morningMessage.textContent = "";
  dom.morningFinale.hidden = true;
  dom.restartMorningSheepButton.hidden = true;
  dom.doneMorningSheepButton.hidden = true;
  morningSheepReturnFocus?.focus();
  morningSheepReturnFocus = null;
}

/** Validates the form, then adds or replaces the entry for the chosen date. */
function handleSaveEntry() {
  const date = dom.date.value;
  const bed = dom.bedTime.value;
  const wake = dom.wakeTime.value;
  if (!isValidDate(date)) {
    alert(t("error.invalidDate"));
    return;
  }
  if (!isValidTime(bed) || !isValidTime(wake)) {
    alert(t("error.invalidTimes"));
    return;
  }

  const totalMinutes = getDurationMinutes(bed, wake);
  const awakeMinutes = dom.awakeMinutes.value === "" ? 0 : Number(dom.awakeMinutes.value);
  const napMinutes = dom.napSelect.value === "1"
    ? (dom.napMinutes.value === "" ? 0 : Number(dom.napMinutes.value))
    : 0;
  if (totalMinutes <= 0) {
    alert(t("error.sameTimes"));
    return;
  }
  if (
    !Number.isInteger(awakeMinutes) ||
    awakeMinutes < 0 ||
    awakeMinutes > totalMinutes ||
    awakeMinutes % 5 !== 0
  ) {
    alert(t("error.awake"));
    return;
  }
  if (!Number.isInteger(napMinutes) || napMinutes < 0 || napMinutes % 5 !== 0) {
    alert(t("error.nap"));
    return;
  }
  if (!Number.isInteger(selectedQuality) || selectedQuality < 1 || selectedQuality > 5) {
    alert(t("error.quality"));
    return;
  }
  if (dom.notes.value.length > MAX_NOTE_LENGTH) {
    alert(t("error.notesLength", { max: MAX_NOTE_LENGTH }));
    return;
  }
  const medication = dom.medicationSelect.value === "1";
  const medicationName = medication ? dom.medicationName.value.trim() : "";
  if (medication && !medicationName) {
    alert(t("error.medicationName"));
    return;
  }
  if (medicationName.length > MAX_NOTE_LENGTH) {
    alert(t("error.medicationLength", { max: MAX_NOTE_LENGTH }));
    return;
  }

  const targetEntry = entries.find((entry) => entry.date === date);
  if (targetEntry && date !== editingDate) {
    alert(t("error.duplicateDate"));
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
    medication,
    medicationName,
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
  const dateLabel = formatDate(new Date(entry.date + "T12:00"), language, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const stars = entry.quality == null
    ? t("history.qualityMissing")
    : "★".repeat(entry.quality) + "☆".repeat(5 - entry.quality);
  const notesSuffix = entry.notes ? ` · ${escapeHtml(entry.notes)}` : "";
  const medicationSuffix = entry.medication
    ? ` · ${t("history.medication", { name: escapeHtml(entry.medicationName) })}`
    : "";
  const napSuffix = entry.nap
    ? ` · ${t("history.nap", { minutes: formatNumber(entry.nap, language) })}`
    : "";

  // Buttons carry the entry date in data-date; clicks are handled via delegation
  return `
    <div class="entry">
      <div class="entry-head">
        <div>
          <b>${dateLabel}</b>
          <div class="badge">${entry.bed} – ${entry.wake}</div>
        </div>
        <div>
          <b>${formatMinutes(entry.effective, language)}</b>
          <div class="badge">${stars}</div>
        </div>
      </div>
      <div class="small">${t("history.awake", { minutes: formatNumber(entry.awake, language) })}${napSuffix}${medicationSuffix}${notesSuffix}</div>
      <br>
      <button class="secondary" data-action="edit" data-date="${entry.date}">${t("history.edit")}</button>
      <button class="secondary danger" data-action="delete" data-date="${entry.date}">${t("history.delete")}</button>
    </div>`;
}

function renderHistory() {
  if (!entries.length) {
    dom.historyList.innerHTML = `<div class="empty">${t("history.empty")}</div>`;
    return;
  }
  dom.historyList.innerHTML = entries.map(renderHistoryEntry).join("");
}

function deleteEntry(date) {
  if (!confirm(t("confirm.deleteEntry"))) return;

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
  const period = getRollingSleepPeriod(entries, formatLocalDate(new Date()), STATS_DAY_COUNT);
  const { statistics } = period;
  byId("statsPeriod").textContent = t("stats.period", {
    start: formatDate(new Date(`${period.startDate}T12:00:00`), language),
    end: formatDate(new Date(`${period.endDate}T12:00:00`), language),
  });

  // Summary tiles
  dom.statCards.innerHTML = `
    <div class="stat"><span class="small">${t("stats.averageTotal")}</span><b>${statistics.averageTotal == null ? "–" : formatMinutes(statistics.averageTotal, language)}</b></div>
    <div class="stat"><span class="small">${t("stats.averageEffective")}</span><b>${formatMinutes(statistics.averageEffective, language)}</b></div>
    <div class="stat"><span class="small">${t("stats.averageAwake")}</span><b>${statistics.averageAwake == null ? "–" : `${formatNumber(statistics.averageAwake, language)} ${t("time.minutes")}`}</b></div>
    <div class="stat"><span class="small">${t("stats.averageNap")}</span><b>${statistics.averageNap == null ? "–" : `${formatNumber(statistics.averageNap, language)} ${t("time.minutes")}`}</b></div>
    <div class="stat"><span class="small">${t("stats.averageQuality")}</span><b>${statistics.averageQuality == null ? "–" : `${formatNumber(statistics.averageQuality, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 5`}</b></div>
    <div class="stat"><span class="small">${t("stats.nights")}</span><b>${formatNumber(statistics.nights, language)}</b></div>`;

  dom.chart.innerHTML = renderSleepChart(period.days, "effective");
  byId("chartAwake").innerHTML = renderSleepChart(period.days, "awake");
  byId("chartNap").innerHTML = renderSleepChart(period.days, "nap");
  byId("chartQuality").innerHTML = renderSleepChart(period.days, "quality");
}

/* --------------------------------------------------------------------------
   Settings (view: "Einstellungen")
   -------------------------------------------------------------------------- */

async function handleExportPdf() {
  try {
    const { createSleepReport } = await import("./pdf-report.js");
    createSleepReport(entries, language).save("schlaftagebuch.pdf");
  } catch (error) {
    alert(t("error.pdf", { error: error.message }));
  }
}

function handleSaveSettings() {
  const nextSettings = {
    start: dom.defaultStart.value,
    end: dom.defaultEnd.value,
  };
  if (!isValidSettings(nextSettings)) {
    alert(t("error.windowSettings"));
    return;
  }
  if (!saveSettings(nextSettings)) return;
  renderWindowInfo();
  clearTimeout(settingsSavedTimeout);
  dom.settingsSavedNotice.hidden = false;
  settingsSavedTimeout = setTimeout(() => {
    dom.settingsSavedNotice.hidden = true;
  }, 2200);
  resetForm();
}

/** Downloads settings and entries as a JSON file. */
function handleExport() {
  const json = JSON.stringify({ settings, entries }, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = "schlaftagebuch-export.json";
  try {
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function parseImportData(rawData) {
  const parsed = JSON.parse(rawData);
  const payload = Array.isArray(parsed)
    ? { entries: parsed, settings }
    : parsed;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entries)) {
    throw new Error(t("error.importShape"));
  }

  const importedEntries = payload.entries.map(validateEntry);
  if (importedEntries.some((entry) => entry === null)) {
    throw new Error(t("error.importEntry"));
  }
  if (new Set(importedEntries.map((entry) => entry.date)).size !== importedEntries.length) {
    throw new Error(t("error.importDuplicate"));
  }

  const importedSettings = payload.settings == null ? settings : payload.settings;
  if (!isValidSettings(importedSettings)) {
    throw new Error(t("error.importSettings"));
  }
  importedEntries.sort((a, b) => b.date.localeCompare(a.date));
  return { entries: importedEntries, settings: { ...importedSettings } };
}

function replaceWithImportedData(importedData) {
  if (entries.length || settings.start !== DEFAULT_SETTINGS.start || settings.end !== DEFAULT_SETTINGS.end) {
    if (!confirm(t("confirm.importReplace"))) {
      return;
    }
  }

  let previousEntries;
  let previousSettings;
  try {
    previousSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    previousEntries = localStorage.getItem(ENTRIES_STORAGE_KEY);
  } catch (error) {
    alert(t("error.importReadStorage", { error: error.message }));
    return;
  }

  let settingsUpdated = false;
  let entriesUpdated = false;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(importedData.settings));
    settingsUpdated = true;
    localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(importedData.entries));
    entriesUpdated = true;
  } catch (error) {
    try {
      if (settingsUpdated) {
        if (previousSettings == null) localStorage.removeItem(SETTINGS_STORAGE_KEY);
        else localStorage.setItem(SETTINGS_STORAGE_KEY, previousSettings);
      }
      if (entriesUpdated) {
        if (previousEntries == null) localStorage.removeItem(ENTRIES_STORAGE_KEY);
        else localStorage.setItem(ENTRIES_STORAGE_KEY, previousEntries);
      }
    } catch (rollbackError) {
      alert(t("error.importRollback", { error: error.message, rollbackError: rollbackError.message }));
      return;
    }
    alert(t("error.importPreserved", { error: error.message }));
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
  alert(t("notice.importSuccess"));
}

function handleImportText(rawData) {
  try {
    replaceWithImportedData(parseImportData(rawData));
  } catch (error) {
    alert(t("error.importInvalid", { error: error.message }));
  }
}

async function handleImportFile() {
  const file = dom.importFile.files && dom.importFile.files[0];
  if (!file) {
    alert(t("error.importFileRequired"));
    return;
  }
  try {
    handleImportText(await file.text());
  } catch (error) {
    alert(t("error.importFileRead", { error: error.message }));
  }
}

function handleRestoreRawData() {
  if (!dom.importRawData.value.trim()) {
    alert(t("error.importRawRequired"));
    return;
  }
  handleImportText(dom.importRawData.value);
}

function handleClearAllData() {
  if (!confirm(t("confirm.clear"))) return;

  try {
    localStorage.removeItem(ENTRIES_STORAGE_KEY);
  } catch (error) {
    alert(t("error.clear", { error: error.message }));
    return;
  }
  entries = [];
  resetForm();
  renderHistory();
  renderStats();
}

function openWelcomeIfNeeded() {
  try {
    if (localStorage.getItem(WELCOME_DISMISSED_STORAGE_KEY) === "true") return;
  } catch (error) {
    alert(t("error.introRead", { error: error.message }));
  }

  dom.welcomeDialog.showModal();
  dom.welcomeStartButton.focus();
}

function handleWelcomeClosed() {
  if (!dom.welcomeDismissCheckbox.checked) return;
  try {
    localStorage.setItem(WELCOME_DISMISSED_STORAGE_KEY, "true");
  } catch (error) {
    alert(t("error.introSave", { error: error.message }));
  }
}

function changeLanguage(nextLanguage) {
  if (!SUPPORTED_LANGUAGES.includes(nextLanguage) || nextLanguage === language) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  } catch (error) {
    alert(translate(nextLanguage, "error.languageSave", { error: error.message }));
    dom.languageSelect.value = language;
    return;
  }

  clearTimeout(settingsSavedTimeout);
  dom.settingsSavedNotice.hidden = true;
  language = nextLanguage;
  applyStaticTranslations();
  renderWindowInfo();
  renderStars();
  updateCalculatedDurations();
  if (editingDate) dom.todayTitle.textContent = t("today.edit");
  renderHistory();
  renderStats();
  if (dom.sheepDialog.open) {
    updateSheepCount();
    if (sheepCount >= SHEEP_COUNT) {
      dom.sheepFinale.textContent = t(`sheep.message.${sheepFinaleMessageIndex}`);
    }
  }
  if (dom.morningSheepDialog.open) {
    dom.morningMessage.textContent = t(`morning.phase.${morningSheepPhase}`);
  }
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
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle("active", isActive);
    if (isActive) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
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

  dom.medicationSelect.addEventListener("change", () => updateMedicationFields(true));
  dom.date.addEventListener("change", () => {
    if (dom.medicationSelect.value === "1") updateMedicationFields(true);
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
  dom.languageSelect.addEventListener("change", () => changeLanguage(dom.languageSelect.value));
  dom.exportButton.addEventListener("click", handleExport);
  dom.exportPdfButton.addEventListener("click", handleExportPdf);
  dom.statsExportPdfButton.addEventListener("click", handleExportPdf);
  dom.countSheepButton.addEventListener("click", openSheepCounter);
  dom.wakeSheepButton.addEventListener("click", openMorningSheep);
  dom.closeSheepButton.addEventListener("click", () => dom.sheepDialog.close());
  dom.restartSheepButton.addEventListener("click", startSheepCounting);
  dom.sheepDialog.addEventListener("close", closeSheepCounter);
  dom.sheepDialog.addEventListener("click", (event) => {
    if (event.target === dom.sheepDialog) dom.sheepDialog.close();
  });
  dom.closeMorningSheepButton.addEventListener("click", () => dom.morningSheepDialog.close());
  dom.restartMorningSheepButton.addEventListener("click", startMorningSheep);
  dom.doneMorningSheepButton.addEventListener("click", () => dom.morningSheepDialog.close());
  dom.morningSheepDialog.addEventListener("close", closeMorningSheep);
  dom.morningSheepDialog.addEventListener("click", (event) => {
    if (event.target === dom.morningSheepDialog) dom.morningSheepDialog.close();
  });
  dom.importButton.addEventListener("click", () => dom.importDialog.showModal());
  dom.importJsonButton.addEventListener("click", () => dom.importFile.click());
  dom.importFile.addEventListener("change", handleImportFile);
  dom.restoreRawButton.addEventListener("click", handleRestoreRawData);
  dom.cancelImportButton.addEventListener("click", () => dom.importDialog.close());
  dom.clearButton.addEventListener("click", handleClearAllData);
  dom.closeWelcomeButton.addEventListener("click", () => dom.welcomeDialog.close());
  dom.welcomeStartButton.addEventListener("click", () => dom.welcomeDialog.close());
  dom.welcomeDialog.addEventListener("close", handleWelcomeClosed);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !dom.welcomeDialog.open) return;
    event.preventDefault();
    dom.welcomeDialog.close();
  });
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */

function init() {
  applyStaticTranslations();
  dom.defaultStart.value = settings.start;
  dom.defaultEnd.value = settings.end;
  renderWindowInfo();
  dom.napMinutes.disabled = true;

  bindEvents();
  resetForm();
  renderHistory();
  renderStats();
  openWelcomeIfNeeded();
}

init();
