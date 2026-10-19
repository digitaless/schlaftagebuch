import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSleepStatistics,
  formatMinutes,
  getDurationMinutes,
  getSleepDurationChartData,
  isValidDate,
  validateEntries,
  validateEntry,
} from "../src/sleep-data.js";
import { formatDate, formatNumber, getTranslationKeys, translate } from "../src/i18n.js";

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

test("chart data is chronological and uses the same minimum scale as the statistics view", () => {
  const data = getSleepDurationChartData([
    { date: "2026-10-19", effective: 300 },
    { date: "2026-10-18", effective: 450 },
  ]);

  assert.deepEqual(data.chronological.map(({ date }) => date), ["2026-10-18", "2026-10-19"]);
  assert.equal(data.maxMinutes, 480);
  assert.equal(getSleepDurationChartData([]).maxMinutes, 480);
});

test("translation dictionaries have matching keys and fall back to German", () => {
  const germanKeys = getTranslationKeys("de").sort();
  assert.deepEqual(getTranslationKeys("fr").sort(), germanKeys);
  assert.deepEqual(getTranslationKeys("en").sort(), germanKeys);
  assert.equal(translate("fr", "intro.title"), "Bienvenue dans votre journal du sommeil");
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
  assert.equal(formatNumber(1234.5, "de"), "1'234.5");
  assert.equal(formatMinutes(425, "fr"), "7 h 05 min");
  assert.equal(formatMinutes(425, "en"), "7 h 05 min");
});
