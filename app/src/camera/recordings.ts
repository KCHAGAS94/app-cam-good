/** Helpers to read the memory-card recording replies (get_record_day / hour / min). */

const bit = (mask: number, i: number) => (mask & (1 << i)) !== 0;
const pad = (n: number) => String(n).padStart(2, '0');

export type RecordDay = {key: string; date: Date};

/**
 * get_record_day reply -> days with recordings, newest first.
 * The key is what get_record_hour expects ("2026_11_5": month padded, day not, like the vendor app).
 */
export function parseRecordDays(reply: Record<string, any>, requestedYear: number): RecordDay[] {
  let year = Number(reply.year ?? requestedYear);
  if (!year || year < 2018) {
    year = requestedYear;
  }
  const days: RecordDay[] = [];
  for (let m = 0; m < 12; m++) {
    const mask = Number(reply[`month[${m}]`] ?? 0);
    if (mask <= 0) {
      continue;
    }
    for (let d = 0; d < 31; d++) {
      if (bit(mask, d)) {
        days.push({key: `${year}_${pad(m + 1)}_${d + 1}`, date: new Date(year, m, d + 1)});
      }
    }
  }
  return days.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** get_record_hour reply -> hours (0-23) with recordings. */
export function parseRecordHours(reply: Record<string, any>): number[] {
  const mask = Number(reply.record_hour ?? -1);
  if (mask < 0) {
    return [];
  }
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (bit(mask, h)) {
      hours.push(h);
    }
  }
  return hours;
}

/** get_record_min reply -> file names. */
export function parseRecordFiles(reply: Record<string, any>): {files: string[]; needDownload: boolean} {
  const count = Number(reply.record_num ?? 0);
  const needDownload = Number(reply.needDown ?? 0) === 1;
  let files: string[] = [];
  if (Array.isArray(reply.recordList)) {
    files = reply.recordList.map(String);
  } else {
    for (let i = 0; i < count; i++) {
      const name = reply[`record_name[${i}]`];
      if (name) {
        files.push(String(name));
      }
    }
  }
  return {files: files.filter(f => f && f.indexOf('-1') < 0).sort(), needDownload};
}

/** "2026_11_14" + 15 -> "2026_11_14_15" (format of get_record_min). */
export const hourKey = (dayKey: string, hour: number) => `${dayKey}_${pad(hour)}`;

/**
 * Best-effort readable time from a file name such as "20261114153012.av" -> "15:30:12".
 * Falls back to the raw name.
 */
export function fileLabel(name: string): string {
  const digits = name.replace(/\D/g, '');
  if (digits.length >= 14) {
    return `${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  }
  if (digits.length >= 12) {
    return `${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  return name;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const dayLabel = (d: Date) =>
  `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

export const hourLabel = (h: number) => `${pad(h)}:00 – ${pad(h)}:59`;
