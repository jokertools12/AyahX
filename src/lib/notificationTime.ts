const relative = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });

export function notificationTimeAgo(value: string, now = Date.now()): string {
  // MySQL dateStrings contain UTC without an offset; treating them as local
  // browser time made new notifications look three hours old in Cairo.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return 'وقت غير محدد';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return relative.format(-minutes, 'minute');
  if (minutes < 1440) return relative.format(-Math.floor(minutes / 60), 'hour');
  return relative.format(-Math.floor(minutes / 1440), 'day');
}
