import { useEffect } from 'react';
import { useAdmin, useText } from '../../adminState';
import { useAdminResource } from '../../useAdminResource';
import { ErrorState, LoadingState, StatusChip } from '../../ui/AdminPrimitives';
import { EvidencePanel } from './WorkspaceShared';
import type { StorageTask } from '../../workspace/contracts';
export function StorageTaskProgress({ id }: { id: string }) {
  const query = useAdminResource<StorageTask>('/storage/tasks/' + id), { lang } = useAdmin(), t = useText();
  const status = query.data?.data.status;
  const refetch = query.refetch;
  useEffect(() => { if (status && ['succeeded', 'failed', 'cancelled'].includes(status)) return; const timer = window.setInterval(() => void refetch(), 5000); return () => window.clearInterval(timer); }, [refetch, status]);
  if (query.isPending) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const task = query.data!.data;
  return <section className="admin-card admin-stack"><h3>{t('متابعة الفحص', 'Verification progress')}</h3><StatusChip status={task.status} lang={lang} /><progress max={100} value={task.progress} aria-label={t('تقدم الفحص', 'Verification progress')} />{task.error_code && <p title={task.error_code}>{t('لم ينجح الفحص. اقرأ السبب المحفوظ؛ الملف لا يُعتمد تلقائيًا.', 'The check did not pass. Read the retained reason; files are never approved automatically.')}</p>}{task.result != null && <EvidencePanel value={task.result} title={t('نتيجة الفحص المحفوظة', 'Retained verification result')} />}</section>;
}
