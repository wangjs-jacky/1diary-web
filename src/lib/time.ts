export function localJournalTime(date = new Date()) {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return {
    journalDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    journalTime: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  };
}

export function formatDiaryDate(date: string, time?: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year!, month! - 1, day!);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(value);
  return {
    year,
    month,
    day,
    weekday,
    label: `${month} 月 ${day} 日 · ${weekday}${time ? ` · ${time.slice(0, 5)}` : ''}`,
  };
}
