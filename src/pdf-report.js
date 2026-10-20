import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  formatDate,
  formatNumber,
  translate,
} from "./i18n.js";
import {
  formatMinutes,
  getQualityLabel,
  getRollingSleepPeriod,
  getSleepChartData,
  STATS_DAY_COUNT,
  toLocalDateISO,
} from "./sleep-data.js";

const PAGE_MARGIN = 10;
const PAGE_WIDTH = 297;
const TABLE_WIDTHS = [23, 18, 22, 31, 19, 31, 20, 31, 82];

function formatReportDate(dateString, language) {
  return formatDate(new Date(`${dateString}T12:00:00`), language);
}

function formatDateRange(startDate, endDate, language) {
  return `${formatReportDate(startDate, language)}${translate(language, "date.rangeSeparator")}${formatReportDate(endDate, language)}`;
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
      entry.quality == null
        ? "–"
        : `${entry.quality}/5 (${getQualityLabel(entry.quality, language)})`,
      details || "–",
    ];
  });
}

function drawMetricChart(doc, days, property, titleKey, language, x, y, width) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(translate(language, titleKey), x, y + 4);

  const { chronological, maxValue } = getSleepChartData(days, property);
  if (!chronological.some(({ value }) => Number.isFinite(value))) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(translate(language, "pdf.noChartData"), x, y + 22);
  }

  const slotWidth = width / chronological.length;
  const baselineY = y + 37;
  const maxBarHeight = 21;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.line(x, baselineY, x + width, baselineY);

  chronological.forEach(({ date, value }, index) => {
    const xCenter = x + slotWidth * (index + 0.5);
    const barWidth = Math.min(5, slotWidth * 0.48);
    const hasValue = Number.isFinite(value);
    const barHeight = hasValue ? (value / maxValue) * maxBarHeight : 0;
    const barX = xCenter - barWidth / 2;
    const barY = baselineY - barHeight;

    if (hasValue && value > 0) {
      doc.setFillColor(71, 85, 105);
      doc.rect(barX, barY, barWidth, barHeight, "F");
      doc.circle(xCenter, barY, 0.7, "F");
    } else if (hasValue) {
      doc.circle(xCenter, baselineY - 0.7, 0.7, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(hasValue ? 51 : 100, hasValue ? 65 : 116, hasValue ? 85 : 139);
    doc.text(hasValue ? formatNumber(value, language) : "–", xCenter, hasValue ? Math.max(y + 12, barY - 1.8) : baselineY - 1.8, {
      align: "center",
    });
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    doc.text(formatDate(new Date(`${date}T12:00:00`), language, { day: "2-digit", month: "2-digit" }), xCenter, y + 44, {
      align: "center",
    });
  });
}

export function createSleepReport(entries, language = "de", createdAt = new Date()) {
  const period = getRollingSleepPeriod(entries, toLocalDateISO(createdAt), STATS_DAY_COUNT);
  const reportEntries = period.nights;
  const statistics = period.statistics;
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
    translate(language, "pdf.range", {
      range: formatDateRange(period.startDate, period.endDate, language),
    }),
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
    [translate(language, "pdf.averageNap"), statistics.averageNap == null ? "–" : `${formatNumber(statistics.averageNap, language)} ${translate(language, "time.minutes")}`],
    [translate(language, "pdf.averageQuality"), statistics.averageQuality == null ? "–" : `${formatNumber(statistics.averageQuality, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 5`],
  ];
  const cardGap = 4;
  const cardWidth = (PAGE_WIDTH - 2 * PAGE_MARGIN - (summary.length - 1) * cardGap) / summary.length;
  summary.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * (cardWidth + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x, 35, cardWidth, 24, 2, 2, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    doc.text(label, x + 2.5, 40, { maxWidth: cardWidth - 5 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 2.5, 54);
  });

  const chartWidth = (PAGE_WIDTH - 2 * PAGE_MARGIN - 12) / 2;
  drawMetricChart(doc, period.days, "effective", "pdf.chartTitle", language, PAGE_MARGIN, 64, chartWidth);
  drawMetricChart(doc, period.days, "awake", "pdf.awakeChartTitle", language, PAGE_MARGIN + chartWidth + 12, 64, chartWidth);
  drawMetricChart(doc, period.days, "nap", "pdf.napChartTitle", language, PAGE_MARGIN, 117, chartWidth);
  drawMetricChart(doc, period.days, "quality", "pdf.qualityChartTitle", language, PAGE_MARGIN + chartWidth + 12, 117, chartWidth);

  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(translate(language, "pdf.entriesTitle"), PAGE_MARGIN, 15);

  autoTable(doc, {
    startY: 20,
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
  });

  for (let pageNumber = 1; pageNumber <= doc.internal.getNumberOfPages(); pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(translate(language, "pdf.page", { page: pageNumber }), PAGE_WIDTH - PAGE_MARGIN, pageHeight - 5, {
      align: "right",
    });
  }

  return doc;
}
