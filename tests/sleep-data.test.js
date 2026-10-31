import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSleepStatistics,
  formatMinutes,
  getDurationMinutes,
  getRollingSleepPeriod,
  getSleepChartData,
  isValidDate,
  validateEntries,
  validateEntry,
} from "../src/sleep-data.js";
import {
  formatDate,
  formatNumber,
  getPreferredLanguage,
  getTranslationKeys,
  translate,
} from "../src/i18n.js";

const validEntry = {
  date: "2026-10-18",
  bed: "23:00",
  wake: "07:00",
  awake: 30,
  nap: 0,
  quality: 4,
};

test("sleep duration handles midnight and rejects invalid or identical times", () => {
  assert.equal(getDurationMinutes("23:00", "07:00"), 480);
  assert.equal(getDurationMinutes("22:15", "23:45"), 90);
  assert.equal(getDurationMinutes("07:00", "07:00"), 0);
  assert.equal(getDurationMinutes("25:00", "07:00"), null);
  assert.equal(getDurationMinutes("", "07:00"), null);
});

test("entry validation recalculates durations and rejects invalid values", () => {
  assert.deepEqual(
    { total: validateEntry({ ...validEntry, total: 1, effective: 1 }).total,
      effective: validateEntry({ ...validEntry, total: 1, effective: 1 }).effective },
    { total: 480, effective: 450 }
  );
  assert.equal(validateEntry({ ...validEntry, bed: "07:00", wake: "07:00" }), null);
  assert.equal(validateEntry({ ...validEntry, awake: -5 }), null);
  assert.equal(validateEntry({ ...validEntry, awake: 485 }), null);
  assert.equal(validateEntry({ ...validEntry, awake: "NaN" }), null);
  assert.equal(validateEntry({ ...validEntry, nap: -5 }), null);
  assert.equal(validateEntry({ ...validEntry, quality: undefined }).quality, null);
  assert.equal(validateEntry({ ...validEntry, quality: 6 }), null);
  assert.equal(validateEntry({ ...validEntry, date: "2026-02-30" }), null);
  assert.equal(isValidDate("2024-02-29"), true);
});

test("entry collections reject duplicate dates but accept empty data", () => {
  assert.equal(validateEntries([]), true);
  assert.equal(validateEntries([validEntry]), true);
  assert.equal(validateEntries([validEntry, { ...validEntry }]), false);
});

test("statistics exclude missing values and handle empty and single-night datasets", () => {
  assert.deepEqual(calculateSleepStatistics([]), {
    nights: 0,
    averageTotal: null,
    averageEffective: null,
    averageAwake: null,
    averageNap: null,
    averageQuality: null,
  });
  assert.deepEqual(calculateSleepStatistics([{
    total: 480,
    effective: 450,
    awake: 30,
    quality: 4,
  }]), {
    nights: 1,
    averageTotal: 480,
    averageEffective: 450,
    averageAwake: 30,
    averageNap: null,
    averageQuality: 4,
  });
  assert.deepEqual(calculateSleepStatistics([
    { total: 480, effective: 450, awake: 30, quality: 5 },
    { total: 420, effective: null, awake: undefined, quality: null },
  ]), {
    nights: 2,
    averageTotal: 450,
    averageEffective: 450,
    averageAwake: 30,
    averageNap: null,
    averageQuality: 5,
  });
});

test("duration formatting avoids non-finite and negative output", () => {
  assert.equal(formatMinutes(0), "0 h 00 min");
  assert.equal(formatMinutes(425), "7 h 05 min");
  assert.equal(formatMinutes(Number.NaN), "–");
  assert.equal(formatMinutes(Number.POSITIVE_INFINITY), "–");
  assert.equal(formatMinutes(-5), "–");
});

test("rolling sleep period contains chronological calendar days and preserves missing versus zero values", () => {
  const period = getRollingSleepPeriod([
    { ...validEntry, date: "2026-10-19", effective: 450, total: 480, nap: 0 },
    { ...validEntry, date: "2026-10-07", effective: 300, total: 330, awake: 30, nap: 20 },
    { ...validEntry, date: "2026-10-06", effective: 200, total: 240 },
  ], "2026-10-20");

  assert.equal(period.startDate, "2026-10-07");
  assert.equal(period.endDate, "2026-10-20");
  assert.equal(period.days.length, 14);
  assert.equal(period.days[0].date, "2026-10-07");
  assert.equal(period.days.at(-1).date, "2026-10-20");
  assert.equal(period.days[0].awake, 30);
  assert.equal(period.days[0].nap, 20);
  assert.equal(period.days[1].entry, null);
  assert.equal(period.days[1].nap, null);
  assert.equal(period.days[12].awake, 30);
  assert.equal(period.days[12].nap, 0);
  assert.equal(period.nights.length, 2);
  assert.equal(period.statistics.nights, 2);
  assert.equal(period.statistics.averageNap, 10);
  assert.equal(period.statistics.averageQuality, 4);
});

test("rolling period boundaries handle month and year changes", () => {
  const yearEnd = getRollingSleepPeriod([], "2027-01-05");
  assert.equal(yearEnd.startDate, "2026-12-23");
  assert.deepEqual(
    [yearEnd.days[0].date, yearEnd.days.at(-1).date],
    ["2026-12-23", "2027-01-05"]
  );
});

test("chart data includes every calendar day while excluding missing values from its scale", () => {
  const period = getRollingSleepPeriod([
    { ...validEntry, date: "2026-10-19", effective: 300 },
    { ...validEntry, date: "2026-10-18", effective: 450 },
  ], "2026-10-19");
  const data = getSleepChartData(period.days, "effective");
  const awakeData = getSleepChartData(period.days, "awake");

  assert.equal(data.chronological.length, 14);
  assert.equal(data.chronological[0].date, "2026-10-06");
  assert.equal(data.chronological.at(-1).date, "2026-10-19");
  assert.equal(data.chronological[12].value, 450);
  assert.equal(data.maxValue, 480);
  assert.equal(awakeData.chronological[0].value, null);
  assert.equal(awakeData.maxValue, 60);
});

test("translation dictionaries have matching keys and fall back to German", () => {
  const germanKeys = getTranslationKeys("de").sort();
  assert.deepEqual(getTranslationKeys("fr").sort(), germanKeys);
  assert.deepEqual(getTranslationKeys("en").sort(), germanKeys);
  assert.deepEqual(getTranslationKeys("it").sort(), germanKeys);
  for (const language of ["fr", "en", "it"]) {
    for (const key of germanKeys) {
      assert.deepEqual(
        [...translate(language, key).matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort(),
        [...translate("de", key).matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort(),
        `${language}: ${key}`
      );
    }
  }
  assert.equal(translate("fr", "intro.title"), "Bienvenue dans votre journal du sommeil");
  assert.equal(translate("it", "intro.title"), "Benvenuto nel tuo diario del sonno");
  assert.equal(
    translate("de", "intro.settings"),
    "Passe die Einstellungen an, exportiere oder importiere deine Daten und wähle deine bevorzugte Sprache: Deutsch, Französisch, Englisch oder Italienisch."
  );
  assert.match(translate("fr", "intro.settings"), /allemand, français, anglais ou italien/);
  assert.match(translate("en", "intro.settings"), /German, French, English or Italian/);
  assert.match(translate("it", "intro.settings"), /tedesco, francese, inglese o italiano/);
  assert.equal(translate("fr", "missing.key"), "missing.key");
  assert.equal(
    translate("en", "error.notesLength", { max: 500 }),
    "Notes can be no longer than 500 characters."
  );
});

test("date, number and duration formatting use the selected locale without changing values", () => {
  const date = new Date("2026-10-19T12:00:00Z");
  assert.equal(formatDate(date, "de"), "19.10.2026");
  assert.equal(formatDate(date, "fr"), "19/10/2026");
  assert.equal(formatDate(date, "en"), "10/19/2026");
  assert.equal(formatDate(date, "it"), "19/10/2026");
  assert.equal(formatNumber(1234.5, "de"), "1'234.5");
  assert.equal(formatNumber(12345.6, "it"), "12.345,6");
  assert.equal(formatMinutes(425, "fr"), "7 h 05 min");
  assert.equal(formatMinutes(425, "en"), "7 h 05 min");
  assert.equal(formatMinutes(425, "it"), "7 h 05 min");
});

test("browser language preferences select the first supported language", () => {
  assert.equal(getPreferredLanguage(["es-ES", "it-IT", "fr"]), "it");
  assert.equal(getPreferredLanguage(["fr-CA", "en-US"]), "fr");
  assert.equal(getPreferredLanguage(["es-ES"]), "de");
  assert.equal(getPreferredLanguage([]), "de");
});
