import { useState } from 'react';
import { useAdmin, useText } from '../../adminState';
import { useAdminMutation, useAdminResource } from '../../useAdminResource';
import { Button, Field, Input, PageHeader, LoadingState, ErrorState, EmptyState } from '../../ui/AdminPrimitives';
import type { LabelItem } from '../../workspace/contracts';
function LabelEditor({ item }: { item: LabelItem }) {
  const t = useText(), { user } = useAdmin(), [ar, setAr] = useState(item.display_label_ar ?? ''), [en, setEn] = useState(item.display_label_en ?? ''), mutation = useAdminMutation();
  return <article className="admin-card admin-stack"><h2>{item.reciter_name_ar}</h2><div className="catalog-form-grid"><Field id={'label-ar-' + item.id} label={t('الاسم الوصفي بالعربية', 'Arabic recording label')}><Input id={'label-ar-' + item.id} value={ar} onChange={e => setAr(e.target.value)} maxLength={255} /></Field><Field id={'label-en-' + item.id} label={t('الاسم بالإنجليزية (اختياري)', 'English label (optional)')}><Input id={'label-en-' + item.id} dir="ltr" value={en} onChange={e => setEn(e.target.value)} maxLength={255} /></Field></div><Button disabled={!ar.trim() || mutation.pending || !user?.permissions.includes('review.decide')} onClick={() => void mutation.run(`/labels/${item.id}/approve`, 'POST', { display_label_ar: ar.trim(), display_label_en: en.trim(), notes: t('راجعت الاسم الوصفي واعتمدته من صفحة الأسماء.', 'I reviewed and approved this recording label from the labels page.') })}>{t('احفظ الاسم ووافق عليه', 'Save and approve label')}</Button>{mutation.error && <ErrorState error={mutation.error} />}</article>;
}
export default function LabelsPage() {
  const t = useText(), query = useAdminResource<{ items: LabelItem[] }>('/labels');
  return <><PageHeader title={t('الأسماء الوصفية', 'Recording labels')} description={t('عدّل الاسم مباشرة ثم وافق عليه. مثال: اسم القارئ — الأسلوب — مصدر التسجيل.', 'Edit the label directly, then approve it. Example: reader — style — recording source.')} help="labels" />{query.isPending ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data!.data.items.length ? <div className="admin-stage-list">{query.data!.data.items.map(item => <LabelEditor item={item} key={item.id} />)}</div> : <EmptyState text={t('كل الأسماء المطلوبة تمت مراجعتها. ستظهر المسودات الجديدة هنا عند إضافتها.', 'All requested labels are reviewed. New drafts will appear here when added.')} />}</>;
}
