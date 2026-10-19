import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSleepStatistics,
  formatMinutes,
  getDurationMinutes,
  isValidDate,
  validateEntries,
  validateEntry,
} from "../src/sleep-data.js";

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
