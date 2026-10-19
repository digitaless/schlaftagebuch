import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  formatDate,
  formatNumber,
  translate,
} from "./i18n.js";
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

function formatReportDate(dateString, language) {
  return formatDate(new Date(`${dateString}T12:00:00`), language);
}

function formatDateRange(entries, language) {
  if (!entries.length) return translate(language, "pdf.noEntries");
  const chronological = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return `${formatReportDate(chronological[0].date, language)}${translate(language, "date.rangeSeparator")}${formatReportDate(chronological.at(-1).date, language)}`;
}

function createReportRows(entries, language) {
  if (!entries.length) {
    return [[{
      content: translate(language, "pdf.empty"),
      colSpan: TABLE_WIDTHS.length,
      styles: { halign: "center", textColor: [100, 116, 139] },
    }]];
  }

  return entries.map((entry) => {
    const details = [
      entry.medication
        ? translate(language, "pdf.medication", { name: entry.medicationName })
        : "",
      entry.notes,
    ].filter(Boolean).join("\n");
    return [
      formatReportDate(entry.date, language),
      entry.bed,
      entry.wake,
      formatMinutes(entry.total, language),
      `${formatNumber(entry.awake, language)} ${translate(language, "time.minutes")}`,
      formatMinutes(entry.effective, language),
      `${formatNumber(entry.nap, language)} ${translate(language, "time.minutes")}`,
      `${entry.quality}/5 (${getQualityLabel(entry.quality, language)})`,
      details || "–",
    ];
  });
}

function drawEffectiveSleepChart(doc, nights, language) {
  const headingY = 62;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);

  if (!nights.length) {
    doc.text(translate(language, "pdf.chartTitle"), PAGE_MARGIN, headingY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(translate(language, "pdf.noChartData"), PAGE_MARGIN, 74);
    return;
  }

  doc.text(
    translate(language, "pdf.chartRecent", {
      count: formatNumber(nights.length, language),
      unit: translate(language, nights.length === 1 ? "pdf.night" : "pdf.nightsPlural"),
    }),
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
    doc.text(`${formatNumber(entry.effective, language)} ${translate(language, "time.minutes")}`, xCenter, Math.max(69, barY - 1.5), {
      align: "center",
    });
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text(formatDate(new Date(`${entry.date}T12:00:00`), language, { day: "2-digit", month: "2-digit" }), xCenter, 96, {
      align: "center",
    });
  });
}

export function createSleepReport(entries, language = "de", createdAt = new Date()) {
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

  doc.setProperties({
    title: translate(language, "pdf.title"),
    subject: translate(language, "pdf.subject"),
  });
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(translate(language, "pdf.title"), PAGE_MARGIN, 17);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(
    translate(language, "pdf.range", { range: formatDateRange(reportEntries, language) }),
    PAGE_WIDTH - PAGE_MARGIN,
    12,
    { align: "right" }
  );
  doc.text(
    translate(language, "pdf.created", { date: formatDate(createdAt, language) }),
    PAGE_WIDTH - PAGE_MARGIN,
    18,
    { align: "right" }
  );
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(PAGE_MARGIN, 23, PAGE_WIDTH - PAGE_MARGIN, 23);

  doc.setTextColor(51, 65, 85);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(translate(language, "pdf.statistics"), PAGE_MARGIN, 31);

  const summary = [
    [translate(language, "pdf.nights"), formatNumber(statistics.nights, language)],
    [translate(language, "pdf.averageTotal"), statistics.averageTotal == null ? "–" : formatMinutes(statistics.averageTotal, language)],
    [translate(language, "pdf.averageEffective"), statistics.averageEffective == null ? "–" : formatMinutes(statistics.averageEffective, language)],
    [translate(language, "pdf.averageAwake"), statistics.averageAwake == null ? "–" : `${formatNumber(statistics.averageAwake, language)} ${translate(language, "time.minutes")}`],
    [translate(language, "pdf.averageQuality"), statistics.averageQuality == null ? "–" : `${formatNumber(statistics.averageQuality, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 5`],
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
    doc.text(label, x + 3, 40, { maxWidth: cardWidth - 6 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 3, 50);
  });

  drawEffectiveSleepChart(doc, recentNights, language);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(translate(language, "pdf.entriesTitle"), PAGE_MARGIN, 103);

  autoTable(doc, {
    startY: 107,
    margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 15, left: PAGE_MARGIN },
    head: [[
      translate(language, "pdf.date"),
      translate(language, "pdf.bed"),
      translate(language, "pdf.wake"),
      translate(language, "pdf.total"),
      translate(language, "pdf.awake"),
      translate(language, "pdf.effective"),
      translate(language, "pdf.nap"),
      translate(language, "pdf.quality"),
      translate(language, "pdf.details"),
    ]],
    body: createReportRows(reportEntries, language),
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
      doc.text(translate(language, "pdf.page", { page: pageNumber }), PAGE_WIDTH - PAGE_MARGIN, pageHeight - 5, {
        align: "right",
      });
    },
  });

  return doc;
}
