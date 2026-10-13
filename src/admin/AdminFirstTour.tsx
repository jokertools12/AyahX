import { useEffect, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/AdminPrimitives';
import { useAdmin, useText } from './adminState';

const tour = [
  ['ابدأ من هنا', 'تبدأ من هذه الصفحة لمعرفة ما يحتاج قرارك الآن.'],
  ['مركز المراجعة', 'راجع القرارات البشرية المطلوبة، فالفحص التقني لا يؤكد الصوت أو الحقوق بدلًا منك.'],
  ['غرفة الاستماع', 'استمع إلى العينة ثم سجّل قرارًا موثقًا لهوية الصوت عند توفر صلاحيتك.'],
  ['تراخيص المزوّدين', 'راجع الدليل والشروط قبل أي قرار ترخيص محفوظ.'],
  ['تجربة الفيديو', 'أنشئ تجربة حقيقية فقط عندما تتوفر بيانات وصوت مرخّصان.'],
  ['جاهزية الإطلاق', 'تحقق من جميع البوابات؛ الكتالوج يبقى مغلقًا إلى أن تكتمل مرحلته المصرح بها.'],
  ['حالة المشروع', 'اعرف ما اكتمل وما هو محجوب. أعد هذه الجولة من صفحة المساعدة في أي وقت.'],
] as const;

export function AdminFirstTour() {
  const { user } = useAdmin(), t = useText();
  const key = `ayahx-admin-tour-v1:${user?.id ?? 'unknown'}`;
  const [step, setStep] = useState(() => localStorage.getItem(key) ? -1 : 0);
  useEffect(() => { const restart = () => setStep(0); window.addEventListener('ayahx-admin-open-tour', restart); return () => window.removeEventListener('ayahx-admin-open-tour', restart); }, []);
  if (step < 0) return null;
  const current = tour[step], last = step === tour.length - 1;
  const close = () => { localStorage.setItem(key, 'complete'); setStep(-1); };
  return <Dialog open onOpenChange={value => { if (!value) close(); }}><DialogContent data-admin-visual-dialog="first-tour"><DialogHeader><DialogTitle>{t(current[0], current[0])}</DialogTitle><DialogDescription>{t(current[1], current[1])}</DialogDescription></DialogHeader><p className="admin-muted">{t('الخطوة', 'Step')} {step + 1}/{tour.length}</p><DialogFooter><Button variant="outline" onClick={close}>{t('تخطي', 'Skip')}</Button>{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>{t('السابق', 'Back')}</Button>}<Button onClick={() => last ? close() : setStep(step + 1)}>{last ? t('إنهاء', 'Finish') : t('التالي', 'Next')}</Button></DialogFooter></DialogContent></Dialog>;
}
