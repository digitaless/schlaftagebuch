import test from "node:test";
import assert from "node:assert/strict";
import { createSleepReport } from "../src/pdf-report.js";

const createdAt = new Date("2026-10-19T00:00:00Z");

function makeEntry(date, notes = "") {
  return {
    date,
    bed: "23:00",
    wake: "07:00",
    total: 480,
    awake: 30,
    effective: 450,
    nap: 0,
    quality: 4,
    medication: false,
    medicationName: "",
    notes,
  };
}

function dateDaysAgo(daysAgo) {
  const date = new Date("2026-10-19T12:00:00Z");
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

test("PDF report is generated as a single-page A4 landscape document with no entries", () => {
  const report = createSleepReport([], createdAt);

  assert.ok(Math.abs(report.internal.pageSize.getWidth() - 297) < 0.1);
  assert.ok(Math.abs(report.internal.pageSize.getHeight() - 210) < 0.1);
  assert.equal(report.internal.getNumberOfPages(), 1);
  assert.equal(report.lastAutoTable.body.length, 1);
});

test("a short report includes one complete entry on A4 landscape", () => {
  const entry = makeEntry("2026-10-18", "Ruhige Nacht");
  entry.nap = 15;
  entry.medication = true;
  entry.medicationName = "Beispiel";
  const report = createSleepReport([entry], createdAt);

  assert.equal(report.internal.getNumberOfPages(), 1);
  assert.equal(report.lastAutoTable.body.length, 1);
  assert.equal(report.lastAutoTable.columns.length, 9);
  assert.equal(report.lastAutoTable.head[0].cells["2"].text.join(" "), "Aufstehzeit");
  assert.equal(report.lastAutoTable.body[0].cells["6"].text.join(" "), "15 min");
  assert.match(report.lastAutoTable.body[0].cells["8"].text.join(" "), /Medikament: Beispiel/);
  assert.match(report.lastAutoTable.body[0].cells["8"].text.join(" "), /Ruhige Nacht/);
});

test("long reports paginate while retaining their repeated table header", () => {
  const entries = Array.from({ length: 24 }, (_, index) =>
    makeEntry(dateDaysAgo(index + 1), `Notiz ${index + 1}: ${"Text ".repeat(100)}`)
  );
  const report = createSleepReport(entries, createdAt);

  assert.ok(report.internal.getNumberOfPages() > 1);
  assert.equal(report.lastAutoTable.pageNumber, report.internal.getNumberOfPages());
  assert.equal(report.lastAutoTable.body.length, entries.length);
  assert.equal(report.lastAutoTable.columns.length, 9);
  assert.equal(report.lastAutoTable.settings.showHead, "everyPage");
  assert.equal(report.lastAutoTable.settings.rowPageBreak, "auto");
  for (let page = 1; page <= report.internal.getNumberOfPages(); page += 1) {
    report.setPage(page);
    assert.ok(Math.abs(report.internal.pageSize.getWidth() - 297) < 0.1);
    assert.ok(Math.abs(report.internal.pageSize.getHeight() - 210) < 0.1);
  }
});
