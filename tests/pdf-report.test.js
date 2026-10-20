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

test("empty PDF contains the full calendar-period charts and an A4 landscape table page", () => {
  const report = createSleepReport([], "de", createdAt);
  const firstPage = report.internal.pages[1].join("\n");

  assert.ok(Math.abs(report.internal.pageSize.getWidth() - 297) < 0.1);
  assert.ok(Math.abs(report.internal.pageSize.getHeight() - 210) < 0.1);
  assert.equal(report.internal.getNumberOfPages(), 2);
  assert.equal(report.lastAutoTable.body.length, 1);
  assert.match(firstPage, /Noch keine Schlafdaten für ein Diagramm vorhanden/);
  assert.ok(firstPage.includes(String.raw`Kennzahlen \(letzte 14 Tage\)`));
  assert.ok(firstPage.includes("Wachzeit im Bett"));
  assert.ok(firstPage.includes("Tagesschlaf"));
  assert.ok(firstPage.includes("Schlafqualität"));
  assert.match(firstPage, /06\.10\.2026/);
  assert.match(firstPage, /19\.10\.2026/);
});

test("a short report includes one complete entry on A4 landscape", () => {
  const entry = makeEntry("2026-10-18", "Ruhige Nacht");
  entry.nap = 15;
  entry.medication = true;
  entry.medicationName = "Beispiel";
  const report = createSleepReport([entry], "de", createdAt);
  const firstPage = report.internal.pages[1].join("\n");

  assert.equal(report.internal.getNumberOfPages(), 2);
  assert.equal(report.lastAutoTable.body.length, 1);
  assert.equal(report.lastAutoTable.columns.length, 9);
  assert.match(firstPage, /\(1\) Tj/);
  assert.match(firstPage, /\(8 h 00 min\) Tj/);
  assert.match(firstPage, /\(7 h 30 min\) Tj/);
  assert.match(firstPage, /\(30 min\) Tj/);
  assert.match(firstPage, /\(4\.0 \/ 5\) Tj/);
  assert.equal(report.lastAutoTable.head[0].cells["2"].text.join(" "), "Aufstehzeit");
  assert.equal(report.lastAutoTable.body[0].cells["6"].text.join(" "), "15 min");
  assert.match(report.lastAutoTable.body[0].cells["8"].text.join(" "), /Medikament: Beispiel/);
  assert.match(report.lastAutoTable.body[0].cells["8"].text.join(" "), /Ruhige Nacht/);
  assert.match(firstPage, /\(450\) Tj/);
  assert.equal(report.lastAutoTable.body[0].cells["0"].text.join(" "), "18.10.2026");
});

test("PDF report includes all entries and averages within the rolling 14-day period", () => {
  const entries = Array.from({ length: 8 }, (_, index) => {
    const entry = makeEntry(dateDaysAgo(index + 1));
    entry.effective = 400 + index * 5;
    return entry;
  });
  const report = createSleepReport(entries, "de", createdAt);
  const firstPage = report.internal.pages[1].join("\n");

  assert.ok(firstPage.includes(String.raw`Kennzahlen \(letzte 14 Tage\)`));
  assert.match(firstPage, /\(6 h 58 min\) Tj/);
  assert.match(firstPage, /\(435\) Tj/);
  assert.equal(report.lastAutoTable.body.length, 8);
});

test("PDF distinguishes recorded zero values from missing diary entries and ratings", () => {
  const noRatingEntry = makeEntry("2026-10-18");
  noRatingEntry.quality = null;
  noRatingEntry.awake = 0;
  noRatingEntry.nap = 0;
  const report = createSleepReport([noRatingEntry], "de", createdAt);
  const firstPage = report.internal.pages[1].join("\n").replaceAll("\u0096", "–");
  const qualityCell = report.lastAutoTable.body[0].cells["7"].text.join(" ");

  assert.match(firstPage, /\(0 min\) Tj/);
  assert.equal(qualityCell, "–");
  assert.match(firstPage, /\(0\) Tj/);
  assert.match(firstPage, /\(–\) Tj/);
});

test("PDF charts retain readable labels for small positive measurements", () => {
  const fiveMinuteEntry = makeEntry("2026-10-18");
  fiveMinuteEntry.awake = 5;
  fiveMinuteEntry.effective = 475;
  const tenMinuteEntry = makeEntry("2026-10-17");
  tenMinuteEntry.awake = 10;
  tenMinuteEntry.effective = 470;
  const report = createSleepReport([fiveMinuteEntry, tenMinuteEntry], "de", createdAt);
  const firstPage = report.internal.pages[1].join("\n");

  assert.match(firstPage, /\(5\) Tj/);
  assert.match(firstPage, /\(10\) Tj/);
  assert.match(firstPage, /\(18\.10\.\) Tj/);
  assert.match(firstPage, /\(17\.10\.\) Tj/);
});

test("long reports paginate while retaining their repeated table header", () => {
  const entries = Array.from({ length: 14 }, (_, index) =>
    makeEntry(dateDaysAgo(index), `Notiz ${index + 1}: ${"Text ".repeat(100)}`)
  );
  const report = createSleepReport(entries, "de", createdAt);

  assert.ok(report.internal.getNumberOfPages() > 1);
  assert.equal(report.lastAutoTable.pageNumber, report.internal.getNumberOfPages() - 1);
  assert.equal(report.lastAutoTable.body.length, entries.length);
  assert.equal(report.lastAutoTable.columns.length, 9);
  assert.equal(report.lastAutoTable.settings.showHead, "everyPage");
  assert.equal(report.lastAutoTable.settings.rowPageBreak, "auto");
  for (let page = 1; page <= report.internal.getNumberOfPages(); page += 1) {
    report.setPage(page);
    assert.ok(Math.abs(report.internal.pageSize.getWidth() - 297) < 0.1);
    assert.ok(Math.abs(report.internal.pageSize.getHeight() - 210) < 0.1);
    assert.ok(report.internal.pages[page].join("\n").includes(`(Seite ${page}) Tj`));
  }
});

test("PDF text, dates, statistics and table headers use all supported languages", () => {
  const entry = makeEntry("2026-10-18");
  const cases = [
    ["de", "Schlaftagebuch", "Erfasste Nächte", "Aufstehzeit", "18.10.2026"],
    ["fr", "journal du sommeil", "Nuits enregistrées", "Lever", "18/10/2026"],
    ["en", "Sleep Diary", "Recorded nights", "Wake-up", "10/18/2026"],
  ];

  for (const [language, title, nightsLabel, wakeLabel, dateLabel] of cases) {
    const report = createSleepReport([entry], language, createdAt);
    const firstPage = report.internal.pages[1].join("\n");

    assert.equal(report.lastAutoTable.head[0].cells["2"].text.join(" "), wakeLabel);
    assert.equal(report.lastAutoTable.body[0].cells["0"].text.join(" "), dateLabel);
    assert.match(firstPage, new RegExp(`\\(${nightsLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\) Tj`));
    assert.match(firstPage, /\(450\) Tj/);
    assert.ok(firstPage.toLowerCase().includes(title.toLowerCase()));
    assert.equal(report.internal.getNumberOfPages(), 2);
  }
});

test("PDF chart titles use all supported languages", () => {
  const cases = [
    ["de", ["Effektive Schlafdauer", "Wachzeit im Bett (Minuten)", "Tagesschlaf (Minuten)", "Schlafqualität (1–5 Sterne)"]],
    ["fr", ["Durée effective de sommeil", "Temps éveillé au lit (minutes)", "Sieste (minutes)", "Qualité du sommeil (1 à 5 étoiles)"]],
    ["en", ["Effective sleep duration", "Time awake in bed (minutes)", "Daytime sleep (minutes)", "Sleep quality (1–5 stars)"]],
  ];

  for (const [language, titles] of cases) {
    const report = createSleepReport([makeEntry("2026-10-18")], language, createdAt);
    const firstPage = report.internal.pages[1]
      .join("\n")
      .replaceAll(String.raw`\(`, "(")
      .replaceAll(String.raw`\)`, ")")
      .replaceAll("\u0096", "–");

    for (const title of titles) {
      assert.ok(firstPage.includes(title), `${language} PDF is missing chart title "${title}"`);
    }
  }
});

test("empty PDFs show a localized chart message rather than an empty chart", () => {
  const cases = [
    ["de", "Noch keine Schlafdaten für ein Diagramm vorhanden."],
    ["fr", "Aucune donnée de sommeil pour créer un graphique."],
    ["en", "No sleep data available to create a chart."],
  ];

  for (const [language, message] of cases) {
    const report = createSleepReport([], language, createdAt);
    const firstPage = report.internal.pages[1].join("\n");
    assert.equal(report.internal.getNumberOfPages(), 2);
    assert.ok(firstPage.includes(message));
    assert.equal(report.lastAutoTable.body.length, 1);
  }
});

test("PDF table excludes entries outside the rolling period", () => {
  const entries = [
    makeEntry("2026-10-19"),
    makeEntry("2026-10-06"),
    makeEntry("2026-10-04"),
  ];
  const report = createSleepReport(entries, "de", createdAt);

  assert.equal(report.lastAutoTable.body.length, 2);
  assert.ok(report.internal.pages[1].join("\n").includes("(2) Tj"));
  assert.deepEqual(
    report.lastAutoTable.body.map((row) => row.cells["0"].text.join(" ")),
    ["06.10.2026", "19.10.2026"]
  );
});
