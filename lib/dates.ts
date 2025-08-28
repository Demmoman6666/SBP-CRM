// lib/dates.ts
type Dateish = Date | string | number;

/** 28/08/2025 */
export function formatDateUK(value: Dateish) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** 28/08/2025 08:15:58 */
export function formatDateTimeUK(value: Dateish) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/** Parse "DD/MM/YYYY" → Date (UTC midnight) */
export function parseUkDate(value: string) {
  // accepts "28/08/2025"
  const [dd, mm, yyyy] = value.split("/").map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}
