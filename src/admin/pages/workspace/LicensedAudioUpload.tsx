import {AdminApiError} from '../../adminApi';
import {readableCode} from '../../workspace/readableEvidence';
import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useAdmin, useText } from '../../adminState';
import { Button, ErrorState, Field, Input } from '../../ui/AdminPrimitives';
import { uploadLicensedAudio, type UploadProgress } from '../../workspace/uploadAudio';
import { planAudioBatch, formatBytes, type UploadPlan } from '../../workspace/uploadPlan';
import { saveUploadCheckpoint, readUploadCheckpoint, clearUploadCheckpoint } from '../../workspace/uploadCheckpoints';
import { termLabel } from '../../i18n/terms';
import { StorageTaskProgress } from './StorageTaskProgress';
export default function LicensedAudioUpload({ recitationId, rightsRef, enabled }: { recitationId: string; rightsRef: string | null; enabled: boolean }) {
  const t = useText(), { user, lang } = useAdmin(), input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  const [plan, setPlan] = useState<UploadPlan<File> | null>(null), [dragging, setDragging] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState<Record<number, UploadProgress>>({}), [errors, setErrors] = useState<Record<number, string>>({}), [tasks, setTasks] = useState<Record<number, string>>({});
  useEffect(() => () => controller.current?.abort(), []);
  const choose = (files: File[]) => { if (busy) return; setPlan(planAudioBatch(files)); setErrors({}); setTasks({}); setProgress({}); };
  const start = async () => {
    if (!plan || !rightsRef || !user || !enabled || busy || plan.rejected.length) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true);
    try {
      for (const planned of plan.files) {
        if (abort.signal.aborted) break;
        try {
          const result = await uploadLicensedAudio({ planned, recitationId, rightsRef, signal: abort.signal, checkpoint: readUploadCheckpoint(localStorage, user.id, recitationId, planned.surah), onCheckpoint: checkpoint => saveUploadCheckpoint(localStorage, user.id, recitationId, planned.surah, checkpoint), onProgress: value => setProgress(old => ({ ...old, [planned.surah]: value })) });
          clearUploadCheckpoint(localStorage, user.id, recitationId, planned.surah);
          if (result.verificationTaskId) setTasks(old => ({ ...old, [planned.surah]: result.verificationTaskId! }));
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError',code=error instanceof AdminApiError?error.code:error instanceof Error&&/^(?:AUDIO|LICENSED|STORAGE)_[A-Z0-9_]+$/u.test(error.message)?error.message:null;
          setErrors(old => ({ ...old, [planned.surah]: cancelled ? t('أوقفت النقل. نقطة الاستئناف محفوظة؛ اختر الملف نفسه وأعد البدء.', 'Transfer stopped. The checkpoint is retained; choose the same file and restart.') : (code?readableCode(code,lang)+'. ':'')+t('لم يكتمل الرفع. أعد المحاولة بنفس الملف للاستئناف.', 'Upload did not complete. Retry with the same file to resume.') }));
          break;
        }
      }
    } finally { setBusy(false); }
  };
  const rejection = (reason: string) => ({ BATCH_LIMIT: t('الحد الأقصى 114 ملفًا', 'Maximum 114 files'), INVALID_CHAPTER_NAME: t('اسم الملف يجب أن يكون رقم السورة فقط، مثل 001.mp3', 'Name must be the chapter number, e.g. 001.mp3'), UNSUPPORTED_AUDIO: t('صيغة صوت غير مدعومة', 'Unsupported audio format'), INVALID_SIZE: t('الملف فارغ أو أكبر من 1GB', 'File is empty or exceeds 1GB'), DUPLICATE_CHAPTER: t('يوجد أكثر من ملف للسورة نفسها؛ اختر ملفًا واحدًا', 'Multiple files match this chapter; choose one') }[reason] ?? t('ملف غير صالح', 'Invalid file'));
  return <section className="admin-stack"><h2>{t('رفع ملفات صوت مرخّصة', 'Upload licensed audio files')}</h2>{!enabled && <p>{t('سجّل قرار الحقوق ودليله أولًا. الرفع معطّل حتى اعتماد الإذن.', 'Record and approve rights evidence first. Upload stays disabled until permission is approved.')}</p>}<div className="admin-upload-drop" data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (enabled && !busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (enabled) choose([...event.dataTransfer.files]); }}><Upload size={32} aria-hidden="true" /><p>{t('اسحب حتى 114 ملفًا هنا، أو اخترها من جهازك. رقم السورة هو اسم الملف: 001.mp3، 002.mp3…', 'Drop up to 114 files here or choose them. Use chapter numbers: 001.mp3, 002.mp3…')}</p><Field id="licensed-audio-files" label={t('اختر ملفات الصوت المرخّصة', 'Choose licensed audio files')}><Input ref={input} id="licensed-audio-files" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav" multiple disabled={!enabled || busy} onChange={event => choose([...(event.target.files ?? [])])} /></Field></div>{plan && <><p>{t('الملفات المقبولة', 'Accepted files')}: {plan.files.length} · {t('سور بلا ملف في هذه الدفعة', 'Chapters without files in this batch')}: {plan.missing.length}</p>{plan.rejected.map((file, index) => <ErrorState key={file.name + index} error={{ message: file.name + ': ' + rejection(file.reason) }} />)}<div className="admin-row"><Button disabled={!enabled || !rightsRef || !plan.files.length || !!plan.rejected.length || busy} onClick={() => void start()}><Upload size={20} aria-hidden="true" />{t('ابدأ الرفع أو استأنف', 'Start or resume upload')}</Button>{busy && <Button variant="outline" onClick={() => controller.current?.abort()}><X size={20} aria-hidden="true" />{t('أوقف النقل مع حفظ الاستئناف', 'Stop and retain checkpoint')}</Button>}</div><div className="admin-stage-list">{plan.files.map(file => <section className="admin-card admin-stack" key={file.surah}><h3>{file.file.name} · {formatBytes(file.file.size, lang)}</h3><p>{progress[file.surah] ? termLabel(progress[file.surah].phase, lang) : t('بانتظار بدء الرفع', 'Awaiting upload')}</p><progress max={file.file.size} value={progress[file.surah]?.loaded ?? 0} aria-label={t(`تقدم رفع السورة ${file.surah}`, `Chapter ${file.surah} upload progress`)} />{errors[file.surah] && <p role="alert">{errors[file.surah]}</p>}{tasks[file.surah] && <StorageTaskProgress id={tasks[file.surah]} />}</section>)}</div></>}</section>;
}
