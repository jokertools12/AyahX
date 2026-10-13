import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, StatusChip } from '../../ui/AdminPrimitives';
import { useAdmin, useText } from '../../adminState';
import { useAdminMutation, useAdminResource } from '../../useAdminResource';

type FeedbackStatus = 'new' | 'in_progress' | 'done';
interface Feedback { id: string; actor_id: string | null; message: string; category: string; path: string; status: FeedbackStatus; created_at: string; }
interface FeedbackPageData { items: Feedback[]; page: number; limit: number; total: number; totalPages: number }
const statusLabels: Record<FeedbackStatus, [string, string]> = { new: ['جديدة', 'New'], in_progress: ['قيد المعالجة', 'In progress'], done: ['تمت', 'Done'] };

export default function FeedbackPage() {
  const { user, lang } = useAdmin(), t = useText(), [page, setPage] = useState(1), mutation = useAdminMutation();
  const manager = !!user?.roles.some(role => role === 'super_admin' || role === 'admin');
  const query = useAdminResource<FeedbackPageData>(`/feedback?page=${page}&limit=25`);
  if (query.isPending) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data!.data;
  return <><PageHeader title={t(manager ? 'ملاحظاتي وملاحظات الفريق' : 'ملاحظاتي', manager ? 'My notes and team notes' : 'My notes')} description={t('الملاحظات تتضمن النص وسياق العرض فقط، ولا تحتوي على لقطات شاشة أو إرسال خارجي.', 'Notes contain text and display context only. They contain no screenshots and are not delivered externally.')} help="feedback" action={<Button asChild variant="outline"><Link to="/admin/diagnostics">{t('التشخيص', 'Diagnostics')}</Link></Button>} />
    <section className="admin-card admin-stack"><div className="admin-row"><strong>{data.total.toLocaleString(lang)}</strong><span className="admin-muted">{t('ملاحظة محفوظة', 'saved notes')}</span></div>{data.items.length === 0 ? <EmptyState text={t('لا توجد ملاحظات بعد. استخدم زر «ملاحظة» العائم في أي صفحة.', 'No notes yet. Use the floating Note button on any page.')} /> : <div className="admin-feedback-list">{data.items.map(item => <article key={item.id} className="admin-feedback-item"><div className="admin-row"><StatusChip status={item.status} lang={lang}/><strong>{t(statusLabels[item.status][0], statusLabels[item.status][1])}</strong><span className="admin-muted">{item.category} · {item.path}</span></div><p>{item.message}</p><div className="admin-row"><time className="admin-muted" dir="ltr">{item.created_at}</time>{manager && <label className="admin-inline-status"><span>{t('الحالة', 'Status')}</span><select className="admin-select" value={item.status} disabled={mutation.pending} onChange={event => void mutation.run(`/feedback/${encodeURIComponent(item.id)}/status`, 'PATCH', { status: event.target.value })}>{(['new', 'in_progress', 'done'] as const).map(status => <option key={status} value={status}>{t(statusLabels[status][0], statusLabels[status][1])}</option>)}</select></label>}</div></article>)}</div>}<div className="admin-row"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</Button><span>{page}/{data.totalPages}</span><Button variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</Button></div></section></>;
}
