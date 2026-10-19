export const DEFAULT_SETTINGS = { start: "23:00", end: "07:00" };
export const MAX_NOTE_LENGTH = 500;
export const QUALITY_LABELS = ["", "gar nicht", "wenig", "mittelmäßig", "ziemlich", "sehr"];
export const STATS_NIGHT_COUNT = 7;

export function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidSettings(value) {
  return (
    value &&
    typeof value === "object" &&
    isValidTime(value.start) &&
    isValidTime(value.end) &&
    value.start !== value.end
  );
}

function timeToMinutes(timeString) {
  if (!isValidTime(timeString)) return null;
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

export function getDurationMinutes(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null) return null;

  let duration = endMinutes - startMinutes;
  if (duration < 0) duration += 24 * 60;
  return duration;
}

export function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "–";
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours} h ${String(remainingMinutes).padStart(2, "0")} min`;
}

export function getQualityLabel(quality) {
  return QUALITY_LABELS[quality] || "Bitte auswählen";
}

export function validateEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isValidDate(value.date) || !isValidTime(value.bed) || !isValidTime(value.wake)) {
    return null;
  }
  if (!Number.isInteger(value.quality) || value.quality < 1 || value.quality > 5) return null;
  if (value.medication != null && typeof value.medication !== "boolean") return null;
  if (value.medicationName != null && typeof value.medicationName !== "string") return null;

  const total = getDurationMinutes(value.bed, value.wake);
  if (total == null || total <= 0) return null;
  const awake = value.awake == null ? 0 : Number(value.awake);
  const nap = value.nap == null ? 0 : Number(value.nap);
  if (
    !Number.isInteger(awake) ||
    awake < 0 ||
    awake > total ||
    awake % 5 !== 0 ||
    !Number.isInteger(nap) ||
    nap < 0 ||
    nap % 5 !== 0
  ) {
    return null;
  }

  const windowStart = value.windowStart == null ? DEFAULT_SETTINGS.start : value.windowStart;
  const windowEnd = value.windowEnd == null ? DEFAULT_SETTINGS.end : value.windowEnd;
  if (!isValidTime(windowStart) || !isValidTime(windowEnd)) return null;
  if (value.notes != null && typeof value.notes !== "string") return null;
  const notes = value.notes || "";
  if (notes.length > MAX_NOTE_LENGTH) return null;
  const medication = value.medication ?? false;
  const medicationName = medication ? (value.medicationName || "").trim() : "";
  if (medicationName.length > MAX_NOTE_LENGTH || (medication && !medicationName)) return null;

  return {
    date: value.date,
    windowStart,
    windowEnd,
    bed: value.bed,
    wake: value.wake,
    total,
    effective: Math.max(0, total - awake),
    awake,
    nap,
    quality: value.quality,
    notes,
    medication,
    medicationName,
  };
}

export function validateEntries(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => validateEntry(entry) !== null) &&
    new Set(value.map((entry) => entry.date)).size === value.length
  );
}

function averageOf(list, property) {
  const values = list.map((entry) => entry[property]).filter(Number.isFinite);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

export function calculateSleepStatistics(nights) {
  const qualityValues = nights
    .map((entry) => entry.quality)
    .filter((quality) => Number.isFinite(quality) && quality >= 1 && quality <= 5);
  return {
    nights: nights.length,
    averageTotal: averageOf(nights, "total"),
    averageEffective: averageOf(nights, "effective"),
    averageAwake: averageOf(nights, "awake"),
    averageQuality: qualityValues.length
      ? qualityValues.reduce((sum, quality) => sum + quality, 0) / qualityValues.length
      : null,
  };
}
