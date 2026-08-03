/**
 * Baghdad Timezone Utilities (Asia/Baghdad, UTC+3)
 */
export function getBaghdadNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Baghdad' }));
}

export function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getBaghdadToday(): string {
  return formatDate(getBaghdadNow());
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function getBaghdadTomorrow(): string {
  return formatDate(addDays(getBaghdadNow(), 1));
}
