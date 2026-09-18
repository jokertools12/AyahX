import { useState, useRef, useCallback, useEffect } from 'react';
import { api, getAuthToken } from '@/lib/api';

export type ServerJobStatus = 'idle' | 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ServerRenderJobState {
  jobId: string | null;
  engine?: string | null;
  status: ServerJobStatus;
  progress: number;
  stage: string;
  error: string | null;
  outputFilename: string | null;
  isRendering: boolean;
  isCompleted: boolean;
  videoBlob: Blob | null;
}

const ACTIVE_RENDER_STORAGE_KEY = 'ayahx-active-render-job-v1';

function persistActiveRenderJob(jobId: string): void {
  try {
    localStorage.setItem(ACTIVE_RENDER_STORAGE_KEY, JSON.stringify({ jobId, savedAt: Date.now() }));
  } catch {
    // Server-side recovery still works when browser storage is unavailable.
  }
}

function clearPersistedRenderJob(jobId?: string): void {
  try {
    const raw = localStorage.getItem(ACTIVE_RENDER_STORAGE_KEY);
    if (!jobId || !raw || JSON.parse(raw)?.jobId === jobId) {
      localStorage.removeItem(ACTIVE_RENDER_STORAGE_KEY);
    }
  } catch {
    try { localStorage.removeItem(ACTIVE_RENDER_STORAGE_KEY); } catch { /* ignore */ }
  }
}

export function useServerRenderJob() {
  const [state, setState] = useState<ServerRenderJobState>({
    jobId: null,
    engine: null,
    status: 'idle',
    progress: 0,
    stage: '',
    error: null,
    outputFilename: null,
    isRendering: false,
    isCompleted: false,
    videoBlob: null,
  });

  const pollIntervalRef = useRef<any>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    clearPersistedRenderJob();
    activeJobIdRef.current = null;
    consecutiveErrorsRef.current = 0;
    setState({
      jobId: null,
      engine: null,
      status: 'idle',
      progress: 0,
      stage: '',
      error: null,
      outputFilename: null,
      isRendering: false,
      isCompleted: false,
      videoBlob: null,
    });
  }, [stopPolling]);

  /**
   * Polls a specific render job ID until completion or cancellation
   */
  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      activeJobIdRef.current = jobId;
      consecutiveErrorsRef.current = 0;

      pollIntervalRef.current = setInterval(async () => {
        try {
          if (!activeJobIdRef.current) {
            stopPolling();
            return;
          }

          const { job: updatedJob } = await api.renderJobs.getJob(activeJobIdRef.current);
          consecutiveErrorsRef.current = 0; // reset error counter on success
          const currentStatus: ServerJobStatus = updatedJob.status;
          const currentProgress = Math.min(100, Math.max(0, Number(updatedJob.progress) || 0));

          if (currentStatus === 'succeeded') {
            stopPolling();
            // Automatically attempt to fetch the ready MP4 blob
            let downloadedBlob: Blob | null = null;
            try {
              downloadedBlob = await api.renderJobs.downloadVideo(updatedJob.id);
            } catch (dlErr) {
              console.warn('Could not auto-fetch downloaded blob:', dlErr);
            }

            setState({
              jobId: updatedJob.id,
              status: 'succeeded',
              progress: 100,
              stage: 'تم إنتاج الفيديو بنجاح! جاهز للتحميل والمشاركة',
              error: null,
              outputFilename: updatedJob.output_filename,
              isRendering: false,
              isCompleted: true,
              videoBlob: downloadedBlob,
            });
          } else if (currentStatus === 'failed') {
            stopPolling();
            setState((prev) => ({
              ...prev,
              status: 'failed',
              stage: 'فشل الريندر',
              error: updatedJob.error_message || 'حدث خطأ غير متوقع أثناء معالجة الفيديو',
              isRendering: false,
              isCompleted: false,
            }));
          } else if (currentStatus === 'cancelled') {
            stopPolling();
            clearPersistedRenderJob(updatedJob.id);
            setState((prev) => ({
              ...prev,
              status: 'cancelled',
              stage: 'تم إلغاء المهمة',
              isRendering: false,
              isCompleted: false,
            }));
          } else {
            // queued or running
            setState((prev) => ({
              ...prev,
              status: currentStatus,
              progress: currentProgress,
              stage:
                updatedJob.stage ||
                (currentStatus === 'queued'
                  ? 'جاري تخصيص وحدة إنتاج تلقائياً...'
                  : 'جاري معالجة الفيديو وتوليد الإطارات...'),
              isRendering: true,
              isCompleted: false,
            }));
          }
        } catch (pollErr: any) {
          console.warn('Render poll error:', pollErr);
          consecutiveErrorsRef.current++;
          // A transient API/Redis/network failure is not a render failure.
          // Keep the durable job ID and continue polling through a restart.
          setState((prev) => ({
            ...prev,
            stage: `جاري إعادة الاتصال بخدمة الإنتاج... (${consecutiveErrorsRef.current})`,
            error: null,
            isRendering: true,
          }));
        }
      }, 1200);
    },
    [stopPolling]
  );

  /**
   * Reconnect to any active or recently completed render job on mount
   */
  const checkActiveJob = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;

    try {
      // Restore the exact job created in this browser before asking for the
      // user's generic recent job. This survives refreshes and avoids showing
      // a different export from another tab/account session.
      try {
        const raw = localStorage.getItem(ACTIVE_RENDER_STORAGE_KEY);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved?.jobId && Date.now() - Number(saved.savedAt || 0) < 48 * 60 * 60 * 1000) {
          const restored = (await api.renderJobs.getJob(saved.jobId)).job;
          activeJobIdRef.current = restored.id;
          const progress = restored.status === 'succeeded'
            ? 100
            : Math.min(100, Math.max(0, Number(restored.progress) || 0));
          if (restored.status === 'queued' || restored.status === 'running') {
            setState({
              jobId: restored.id,
              engine: restored.manifest?.renderEngine || null,
              status: restored.status,
              progress,
              stage: restored.stage || 'جاري استعادة مهمة الإنتاج...',
              error: null,
              outputFilename: restored.output_filename || null,
              isRendering: true,
              isCompleted: false,
              videoBlob: null,
            });
            startPolling(restored.id);
            return;
          }
          if (restored.status === 'succeeded') {
            setState({
              jobId: restored.id,
              engine: restored.manifest?.renderEngine || null,
              status: 'succeeded',
              progress: 100,
              stage: 'فيديو جاهز للتحميل بعد استعادة الصفحة',
              error: null,
              outputFilename: restored.output_filename || null,
              isRendering: false,
              isCompleted: true,
              videoBlob: null,
            });
            return;
          }
          if (restored.status === 'failed' || restored.status === 'cancelled') {
            setState((prev) => ({
              ...prev,
              jobId: restored.id,
              engine: restored.manifest?.renderEngine || null,
              status: restored.status,
              stage: restored.stage || 'انتهت مهمة الإنتاج',
              error: restored.error_message || null,
              outputFilename: restored.output_filename || null,
              isRendering: false,
              isCompleted: false,
            }));
            return;
          }
        } else if (saved?.jobId) {
          clearPersistedRenderJob(saved.jobId);
        }
      } catch (restoreError: any) {
        if (restoreError?.status === 404 || restoreError?.status === 410) {
          clearPersistedRenderJob();
        }
      }

      const res = await api.renderJobs.getActiveJob();
      if (res.hasActiveJob && res.job) {
        const job = res.job;
        activeJobIdRef.current = job.id;
        const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));
        setState({
          jobId: job.id,
          engine: job.manifest?.renderEngine || null,
          status: job.status,
          progress,
          stage:
            job.stage ||
            (job.status === 'queued'
              ? 'جاري تخصيص وحدة إنتاج تلقائياً...'
              : 'جاري معالجة الفيديو وتوليد الإطارات...'),
          error: null,
          outputFilename: job.output_filename || null,
          isRendering: true,
          isCompleted: false,
          videoBlob: null,
        });
        startPolling(job.id);
      } else if (res.recentJob) {
        const rJob = res.recentJob;
        activeJobIdRef.current = rJob.id;
        setState({
          jobId: rJob.id,
          engine: rJob.manifest?.renderEngine || null,
          status: 'succeeded',
          progress: 100,
          stage: 'فيديو سابق جاهز للتحميل (تم إنتاجه بنجاح)',
          error: null,
          outputFilename: rJob.output_filename || null,
          isRendering: false,
          isCompleted: true,
          videoBlob: null,
        });
      }
    } catch (e) {
      // Non-critical background check
      console.warn('Failed checking active render job on mount:', e);
    }
  }, [startPolling]);

  // Check on mount and clean up on unmount
  useEffect(() => {
    checkActiveJob();
    return () => {
      stopPolling();
    };
  }, [checkActiveJob, stopPolling]);

  /**
   * Starts a new server-side deterministic render job.
   * Existing exports are preserved unless the caller explicitly chooses to
   * replace one. This prevents an accidental second click from cancelling a
   * healthy render.
   */
  const startServerRender = useCallback(
    async (
      manifest: any,
      idempotencyKey?: string,
      options?: { replaceActive?: boolean; backgroundAsync?: boolean }
    ): Promise<string> => {
      stopPolling();
      setState({
        jobId: null,
        engine: manifest?.renderEngine || null,
        status: 'submitting',
        progress: 0,
        stage: 'جاري إرسال أمر الريندر إلى الخادم...',
        error: null,
        outputFilename: null,
        isRendering: true,
        isCompleted: false,
        videoBlob: null,
      });

      try {
        const { job } = await api.renderJobs.createJob(manifest, idempotencyKey, {
          replaceActive: options?.replaceActive ?? false,
          backgroundAsync: options?.backgroundAsync ?? false,
        });
        const jobId = job.id;
        activeJobIdRef.current = jobId;
        persistActiveRenderJob(jobId);

        setState((prev) => ({
          ...prev,
          jobId,
          status: job.status,
          progress: Number(job.progress) || 0,
          stage: job.stage || 'جاري تخصيص وحدة إنتاج تلقائياً...',
        }));

        startPolling(jobId);
        return jobId;
      } catch (err: any) {
        stopPolling();
        const message = err.message || 'فشل بدء عملية الريندر على الخادم';
        setState({
          jobId: null,
          engine: manifest?.renderEngine || null,
          status: 'failed',
          progress: 0,
          stage: 'فشل الإرسال',
          error: message,
          outputFilename: null,
          isRendering: false,
          isCompleted: false,
          videoBlob: null,
        });
        throw err;
      }
    },
    [startPolling, stopPolling]
  );

  /**
   * Cancels the currently active job
   */
  const cancelRender = useCallback(async () => {
    if (!activeJobIdRef.current) return;
    try {
      const jobId = activeJobIdRef.current;
      await api.renderJobs.cancelJob(jobId);
      clearPersistedRenderJob(jobId);
      stopPolling();
      setState((prev) => ({
        ...prev,
        status: 'cancelled',
        stage: 'تم إلغاء المهمة',
        isRendering: false,
      }));
    } catch (err) {
      console.error('Failed to cancel render job:', err);
    }
  }, [stopPolling]);

  /**
   * Cancels ALL active or queued jobs for the user and resets the hook to idle
   */
  const cancelActiveRender = useCallback(async () => {
    try {
      stopPolling();
      await api.renderJobs.cancelActiveJob();
      reset();
    } catch (err) {
      console.error('Failed to cancel active render jobs:', err);
      reset();
    }
  }, [reset, stopPolling]);

  /** Requeue the current failed/cancelled job without charging another slot. */
  const retryRender = useCallback(async () => {
    if (!activeJobIdRef.current) return;
    try {
      const { job } = await api.renderJobs.retryJob(activeJobIdRef.current);
      activeJobIdRef.current = job.id;
      persistActiveRenderJob(job.id);
      setState((prev) => ({
        ...prev,
        jobId: job.id,
        status: job.status,
        progress: Number(job.progress) || 0,
        stage: job.stage || 'جاري إعادة تشغيل الإنتاج...',
        error: null,
        isRendering: true,
        isCompleted: false,
        videoBlob: null,
      }));
      startPolling(job.id);
    } catch (err: any) {
      setState((prev) => ({ ...prev, error: err.message || 'تعذر إعادة محاولة الريندر' }));
    }
  }, [startPolling]);

  /**
   * Directly downloads the generated MP4 file
   */
  const downloadRenderedMp4 = useCallback(
    async (customFilename?: string) => {
      if (!activeJobIdRef.current) return;
      try {
        const blob = state.videoBlob || (await api.renderJobs.downloadVideo(activeJobIdRef.current));
        if (!state.videoBlob) setState((prev) => ({ ...prev, videoBlob: blob }));
        const filename = customFilename || state.outputFilename || 'quran-reel.mp4';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err: any) {
        console.error('Download error:', err);
        throw err;
      }
    },
    [state.outputFilename, state.videoBlob]
  );

  return {
    ...state,
    startServerRender,
    cancelRender,
    cancelActiveRender,
    retryRender,
    checkActiveJob,
    downloadRenderedMp4,
    reset,
  };
}
