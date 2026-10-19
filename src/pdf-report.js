import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  calculateSleepStatistics,
  formatMinutes,
  getQualityLabel,
  getSleepDurationChartData,
  STATS_NIGHT_COUNT,
} from "./sleep-data.js";

const PAGE_MARGIN = 10;
const PAGE_WIDTH = 297;
const TABLE_WIDTHS = [23, 18, 22, 31, 19, 31, 20, 31, 82];

function formatReportDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateRange(entries) {
  if (!entries.length) return "Keine Einträge";
  const chronological = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return `${formatReportDate(chronological[0].date)} – ${formatReportDate(chronological.at(-1).date)}`;
}

function createReportRows(entries) {
  if (!entries.length) {
    return [[{
      content: "Noch keine Einträge vorhanden.",
      colSpan: TABLE_WIDTHS.length,
      styles: { halign: "center", textColor: [100, 116, 139] },
    }]];
  }

  return entries.map((entry) => {
    const details = [
      entry.medication ? `Medikament: ${entry.medicationName}` : "",
      entry.notes,
    ].filter(Boolean).join("\n");
    return [
      formatReportDate(entry.date),
      entry.bed,
      entry.wake,
      formatMinutes(entry.total),
      `${entry.awake} min`,
      formatMinutes(entry.effective),
      `${entry.nap} min`,
      `${entry.quality}/5 (${getQualityLabel(entry.quality)})`,
      details || "–",
    ];
  });
}

function drawEffectiveSleepChart(doc, nights) {
  const headingY = 62;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);

  if (!nights.length) {
    doc.text("Effektive Schlafdauer", PAGE_MARGIN, headingY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("Noch keine Schlafdaten für ein Diagramm vorhanden.", PAGE_MARGIN, 74);
    return;
  }

  doc.text(
    `Effektive Schlafdauer - letzte ${nights.length} ${nights.length === 1 ? "Nacht" : "Nächte"}`,
    PAGE_MARGIN,
    headingY
  );

  const { chronological, maxMinutes } = getSleepDurationChartData(nights);
  const chartWidth = PAGE_WIDTH - 2 * PAGE_MARGIN;
  const slotWidth = chartWidth / chronological.length;
  const baselineY = 91;
  const maxBarHeight = 18;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.line(PAGE_MARGIN, baselineY, PAGE_WIDTH - PAGE_MARGIN, baselineY);

  chronological.forEach((entry, index) => {
    const xCenter = PAGE_MARGIN + slotWidth * (index + 0.5);
    const barWidth = Math.min(15, slotWidth * 0.42);
    const barHeight = Math.max(0.5, (entry.effective / maxMinutes) * maxBarHeight);
    const barX = xCenter - barWidth / 2;
    const barY = baselineY - barHeight;

    doc.setFillColor(71, 85, 105);
    doc.rect(barX, barY, barWidth, barHeight, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`${entry.effective} min`, xCenter, Math.max(69, barY - 1.5), {
      align: "center",
    });
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(`${entry.date.slice(8, 10)}.${entry.date.slice(5, 7)}`, xCenter, 96, {
      align: "center",
    });
  });
}

export function createSleepReport(entries, createdAt = new Date()) {
  const reportEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const recentNights = reportEntries.slice(0, STATS_NIGHT_COUNT);
  const statistics = calculateSleepStatistics(recentNights);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setProperties({ title: "Schlaftagebuch", subject: "Schlaf- und Erholungsübersicht" });
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Schlaftagebuch", PAGE_MARGIN, 17);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(`Berichtszeitraum: ${formatDateRange(reportEntries)}`, PAGE_WIDTH - PAGE_MARGIN, 12, {
    align: "right",
  });
  doc.text(`Erstellt am: ${createdAt.toLocaleDateString("de-CH")}`, PAGE_WIDTH - PAGE_MARGIN, 18, {
    align: "right",
  });
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, 23, PAGE_WIDTH - PAGE_MARGIN, 23);

  doc.setTextColor(51, 65, 85);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Kennzahlen (letzte 7 Nächte)", PAGE_MARGIN, 31);

  const summary = [
    ["Erfasste Nächte", String(statistics.nights)],
    ["Ø Gesamtschlafdauer", statistics.averageTotal == null ? "–" : formatMinutes(statistics.averageTotal)],
    ["Ø Effektive Schlafdauer", statistics.averageEffective == null ? "–" : formatMinutes(statistics.averageEffective)],
    ["Ø Wachzeit", statistics.averageAwake == null ? "–" : `${statistics.averageAwake} min`],
    ["Ø Schlafqualität", statistics.averageQuality == null ? "–" : `${statistics.averageQuality.toFixed(1)} / 5`],
  ];
  const cardGap = 4;
  const cardWidth = (PAGE_WIDTH - 2 * PAGE_MARGIN - 4 * cardGap) / summary.length;
  summary.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * (cardWidth + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x, 35, cardWidth, 19, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(label, x + 3, 41);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 3, 49);
  });

  drawEffectiveSleepChart(doc, recentNights);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Einzelne Nächte im Berichtszeitraum", PAGE_MARGIN, 103);

  autoTable(doc, {
    startY: 107,
    margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 15, left: PAGE_MARGIN },
    head: [[
      "Datum",
      "Ins Bett",
      "Aufstehzeit",
      "Gesamtdauer",
      "Wachzeit",
      "Effektive Dauer",
      "Tagesschlaf",
      "Qualität",
      "Medikament / Notizen",
    ]],
    body: createReportRows(reportEntries),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(
      TABLE_WIDTHS.map((cellWidth, index) => [index, { cellWidth }])
    ),
    showHead: "everyPage",
    rowPageBreak: "auto",
    didDrawPage: ({ pageNumber }) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Seite ${pageNumber}`, PAGE_WIDTH - PAGE_MARGIN, pageHeight - 5, {
        align: "right",
      });
    },
  });

  return doc;
}
