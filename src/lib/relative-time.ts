/**
 * "3 minutes ago" for a timestamp, with the exact time left to a `title`.
 *
 * Plain `Intl.RelativeTimeFormat` rather than a date library: one call site
 * needs it, and the browser already knows every locale.
 */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size) return fmt.format(Math.round(seconds / size), unit);
  }
  // ⚠️ Under a minute is "just now", not "in 12 seconds": a clock a little
  // behind the server's would otherwise render an event from the future.
  return "just now";
}
