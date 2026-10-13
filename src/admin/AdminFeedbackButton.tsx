import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Textarea } from './ui/AdminPrimitives';
import { useAdmin, useText } from './adminState';
import { useAdminMutation } from './useAdminResource';

const categories = [
  ['screen_small', 'الشاشة صغيرة', 'Screen is too small'], ['font_small', 'الخط صغير', 'Text is too small'],
  ['colors_annoying', 'الألوان مزعجة', 'Colors are distracting'], ['confusing', 'لا أفهم', 'I do not understand'],
  ['not_working', 'لا يعمل', 'It is not working'],
] as const;

export function AdminFeedbackButton({ density, fontScale }: { density: string; fontScale: number }) {
  const { lang } = useAdmin(), t = useText(), mutation = useAdminMutation();
  const [open, setOpen] = useState(false), [message, setMessage] = useState(''), [category, setCategory] = useState<(typeof categories)[number][0]>('confusing');
  const submit = async () => {
    const scale = window.visualViewport?.scale ?? 1;
    const saved = await mutation.run('/feedback', 'POST', {
      message, category, path: window.location.pathname, viewport_width: window.innerWidth, viewport_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio, zoom_percent: Math.round((100 / scale) * 10) / 10,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', language: lang,
      browser: navigator.userAgent, density, font_scale: fontScale,
    });
    if (saved) { setMessage(''); setCategory('confusing'); setOpen(false); }
  };
  return <><Button className="admin-feedback-fab" data-admin-visual-open="feedback" onClick={() => setOpen(true)} aria-label={t('أضف ملاحظة عن هذه الصفحة', 'Add a note about this page')} title={t('أضف ملاحظة عن هذه الصفحة', 'Add a note about this page')}><MessageSquarePlus size={20} aria-hidden="true" /><span>{t('ملاحظة', 'Note')}</span></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent data-admin-visual-dialog="feedback"><DialogHeader><DialogTitle>{t('ملاحظة عن هذه الصفحة', 'A note about this page')}</DialogTitle><DialogDescription>{t('سنحفظ وصفك وبيانات العرض المحلية فقط: المسار، حجم الشاشة، التكبير، اللغة وإعدادات القراءة. لا نلتقط لقطة شاشة ولا نرسلها إلى خدمة خارجية.', 'We save only your description and local display details: path, viewport, zoom, language and reading settings. No screenshot is captured or sent externally.')}</DialogDescription></DialogHeader>
      <Field id="admin-feedback-category" label={t('نوع الملاحظة', 'Note type')}><select id="admin-feedback-category" className="admin-select" value={category} onChange={event => setCategory(event.target.value as typeof category)}>{categories.map(([value, ar, en]) => <option key={value} value={value}>{t(ar, en)}</option>)}</select></Field>
      <Field id="admin-feedback-message" label={t('ما المشكلة؟ ما الذي كنت تتوقعه؟', 'What is the problem? What did you expect?')}><Textarea id="admin-feedback-message" value={message} maxLength={10000} onChange={event => setMessage(event.target.value)} /></Field>
      {mutation.error && <p role="alert" className="admin-error-inline">{mutation.error.message}</p>}<DialogFooter><Button variant="outline" disabled={mutation.pending} onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</Button><Button disabled={!message.trim() || mutation.pending} onClick={() => void submit()}>{mutation.pending ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ الملاحظة', 'Save note')}</Button></DialogFooter>
    </DialogContent></Dialog></>;
}
