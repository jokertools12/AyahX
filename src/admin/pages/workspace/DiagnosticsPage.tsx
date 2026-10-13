import { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { Button, CodeBlock, PageHeader } from '../../ui/AdminPrimitives';
import { useAdmin, useText } from '../../adminState';
import { copy } from '../../adminClipboard';

export default function DiagnosticsPage() {
  const { lang } = useAdmin(), t = useText();
  const details = useMemo(() => ({ path: window.location.pathname, viewport: `${window.innerWidth}×${window.innerHeight}`, device_pixel_ratio: window.devicePixelRatio, zoom_percent: Math.round((100 / (window.visualViewport?.scale ?? 1)) * 10) / 10, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', language: lang, browser: navigator.userAgent, screen: `${window.screen.width}×${window.screen.height}`, fonts_loaded: Array.from(document.fonts).map(font => font.family).filter((family, index, all) => all.indexOf(family) === index) }), [lang]);
  return <><PageHeader title={t('تشخيص المتصفح', 'Browser diagnostics')} description={t('هذه البيانات تُقرأ من المتصفح الحالي لمساعدتك في وصف مشكلة العرض. لا تُرسل تلقائيًا.', 'These values are read from the current browser to help describe a display issue. They are not sent automatically.')} help="diagnostics" action={<Button variant="outline" onClick={() => void copy(JSON.stringify(details, null, 2))}><Copy size={18} aria-hidden="true" />{t('نسخ التشخيص', 'Copy diagnostics')}</Button>} /><section className="admin-card admin-stack"><CodeBlock value={details} label={t('بيانات المتصفح الحالية', 'Current browser details')} /><p className="admin-muted">{t('انسخها عند الحاجة أو أرسل ملاحظة من الزر العائم؛ نموذج الملاحظة يلتقط السياق نفسه دون صور.', 'Copy this when needed, or send a note from the floating button; the note form captures the same context without images.')}</p></section></>;
}
