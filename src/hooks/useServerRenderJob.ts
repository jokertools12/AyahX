import { useState, useRef, useCallback, useEffect } from 'react';
import { api, getAuthToken } from '@/lib/api';

export type ServerJobStatus = 'idle' | 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ServerRenderJobState {
  jobId: string | null;
  status: ServerJobStatus;
  progress: number;
  stage: string;
  error: string | null;
  outputFilename: string | null;
  isRendering: boolean;
  isCompleted: boolean;
  videoBlob: Blob | null;
  engine: 'ffmpeg_ass' | 'skia_canvas' | 'browser_cloud' | null;
  queuePosition: number;
  etaSeconds: number;
}

const PERSISTED_JOB_KEY = 'ayahx:active-render-job:v2';

export function useServerRenderJob() {
  const [state, setState] = useState<ServerRenderJobState>({
    jobId: null,
    status: 'idle',
    progress: 0,
    stage: '',
    error: null,
    outputFilename: null,
    isRendering: false,
    isCompleted: false,
    videoBlob: null,
    engine: null,
    queuePosition: 0,
    etaSeconds: 0,
  });

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef<number>(0);
  const successfulPollsRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    activeJobIdRef.current = null;
    consecutiveErrorsRef.current = 0;
    successfulPollsRef.current = 0;
    try { window.localStorage.removeItem(PERSISTED_JOB_KEY); } catch { /* storage can be unavailable */ }
    setState({
      jobId: null,
      status: 'idle',
      progress: 0,
      stage: '',
      error: null,
      outputFilename: null,
      isRendering: false,
      isCompleted: false,
      videoBlob: null,
      engine: null,
      queuePosition: 0,
      etaSeconds: 0,
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
      successfulPollsRef.current = 0;
      let terminal = false;

      const scheduleNext = () => {
        if (terminal || !activeJobIdRef.current) return;
        const hidden = typeof document !== 'undefined' && document.hidden;
        const failedAttempts = consecutiveErrorsRef.current;
        const baseDelay = hidden
          ? 15_000
          : failedAttempts > 0
          ? Math.min(5 * 60_000, 1_200 * 2 ** Math.min(8, failedAttempts - 1))
          : Math.min(5_000, 1_200 + successfulPollsRef.current * 380);
        // De-synchronize users who started at the same second without making
        // the progress display feel sluggish.
        const jitter = hidden ? 0 : Math.round(baseDelay * ((Math.random() - 0.5) * 0.2));
        pollTimerRef.current = setTimeout(() => void poll(), Math.max(500, baseDelay + jitter));
      };

      const poll = async () => {
        try {
          if (!activeJobIdRef.current) {
            stopPolling();
            return;
          }

          const { job: updatedJob, queue } = await api.renderJobs.getJob(activeJobIdRef.current);
          consecutiveErrorsRef.current = 0; // reset error counter on success
          successfulPollsRef.current = Math.min(10, successfulPollsRef.current + 1);
          const currentStatus: ServerJobStatus = updatedJob.status;
          const currentProgress = Math.min(100, Math.max(0, Number(updatedJob.progress) || 0));

          if (currentStatus === 'succeeded') {
            terminal = true;
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
              engine: updatedJob.engine || null,
              queuePosition: 0,
              etaSeconds: 0,
            });
            try { window.localStorage.setItem(PERSISTED_JOB_KEY, updatedJob.id); } catch { /* optional persistence */ }
          } else if (currentStatus === 'failed') {
            terminal = true;
            stopPolling();
            setState((prev) => ({
              ...prev,
              status: 'failed',
              stage: 'فشل الريندر',
              error: updatedJob.error_message || 'حدث خطأ غير متوقع أثناء معالجة الفيديو',
              isRendering: false,
              isCompleted: false,
              engine: updatedJob.engine || prev.engine,
              queuePosition: 0,
              etaSeconds: 0,
            }));
            try { window.localStorage.setItem(PERSISTED_JOB_KEY, updatedJob.id); } catch { /* optional persistence */ }
          } else if (currentStatus === 'cancelled') {
            terminal = true;
            stopPolling();
            setState((prev) => ({
              ...prev,
              status: 'cancelled',
              stage: 'تم إلغاء المهمة',
              isRendering: false,
              isCompleted: false,
              engine: updatedJob.engine || prev.engine,
              queuePosition: 0,
              etaSeconds: 0,
            }));
            try { window.localStorage.removeItem(PERSISTED_JOB_KEY); } catch { /* optional persistence */ }
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
              engine: updatedJob.engine || prev.engine,
              queuePosition: Number(queue?.position || 0),
              etaSeconds: Number(queue?.etaSeconds || 0),
            }));
          }
        } catch (pollErr: any) {
          console.warn('Render poll error:', pollErr);
          consecutiveErrorsRef.current++;
          successfulPollsRef.current = 0;
          // A polling outage is not a render failure. Keep the durable job
          // alive and let the next request recover it after a short backoff.
          setState((prev) => ({
            ...prev,
            stage: 'الاتصال بالخادم مؤقتاً غير متاح؛ ما زال الإنتاج محفوظاً ويجري استعادته...',
            error: null,
            isRendering: true,
          }));
        }
        scheduleNext();
      };

      void poll();
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
      const res = await api.renderJobs.getActiveJob();
      if (res.hasActiveJob && res.job) {
        const job = res.job;
        activeJobIdRef.current = job.id;
        try { window.localStorage.setItem(PERSISTED_JOB_KEY, job.id); } catch { /* optional persistence */ }
        const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));
        setState({
          jobId: job.id,
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
          engine: job.engine || null,
          queuePosition: 0,
          etaSeconds: 0,
        });
        startPolling(job.id);
      } else if (res.recentJob) {
        const rJob = res.recentJob;
        activeJobIdRef.current = rJob.id;
        try { window.localStorage.setItem(PERSISTED_JOB_KEY, rJob.id); } catch { /* optional persistence */ }
        setState({
          jobId: rJob.id,
          status: 'succeeded',
          progress: 100,
          stage: 'فيديو سابق جاهز للتحميل (تم إنتاجه بنجاح)',
          error: null,
          outputFilename: rJob.output_filename || null,
          isRendering: false,
          isCompleted: true,
          videoBlob: null,
          engine: rJob.engine || null,
          queuePosition: 0,
          etaSeconds: 0,
        });
      }
    } catch (e) {
      // Non-critical background check
      console.warn('Failed checking active render job on mount:', e);
      try {
        const persistedJobId = window.localStorage.getItem(PERSISTED_JOB_KEY);
        if (persistedJobId) {
          activeJobIdRef.current = persistedJobId;
          setState((prev) => ({
            ...prev,
            jobId: persistedJobId,
            status: 'running',
            stage: 'جاري استعادة حالة الإنتاج بعد انقطاع الاتصال...',
            error: null,
            isRendering: true,
            engine: prev.engine,
          }));
          startPolling(persistedJobId);
        }
      } catch { /* optional persistence */ }
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
        status: 'submitting',
        progress: 0,
        stage: 'جاري إرسال أمر الريندر إلى الخادم...',
        error: null,
        outputFilename: null,
        isRendering: true,
        isCompleted: false,
        videoBlob: null,
        engine: null,
        queuePosition: 0,
        etaSeconds: 0,
      });

      try {
        const { job, queue } = await api.renderJobs.createJob(manifest, idempotencyKey, {
          replaceActive: options?.replaceActive ?? false,
          backgroundAsync: options?.backgroundAsync ?? false,
        });
        const jobId = job.id;
        activeJobIdRef.current = jobId;
        try { window.localStorage.setItem(PERSISTED_JOB_KEY, jobId); } catch { /* optional persistence */ }

        setState((prev) => ({
          ...prev,
          jobId,
          status: job.status,
          progress: Number(job.progress) || 0,
          stage: job.stage || 'جاري تخصيص وحدة إنتاج تلقائياً...',
          engine: job.engine || manifest.renderEngine || null,
          queuePosition: Number(queue?.position || 0),
          etaSeconds: Number(queue?.etaSeconds || 0),
        }));

        startPolling(jobId);
        return jobId;
      } catch (err: any) {
        stopPolling();
        const message = err.message || 'فشل بدء عملية الريندر على الخادم';
        setState({
          jobId: null,
          status: 'failed',
          progress: 0,
          stage: 'فشل الإرسال',
          error: message,
          outputFilename: null,
          isRendering: false,
          isCompleted: false,
          videoBlob: null,
          engine: null,
          queuePosition: 0,
          etaSeconds: 0,
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
      await api.renderJobs.cancelJob(activeJobIdRef.current);
      stopPolling();
      setState((prev) => ({
        ...prev,
        status: 'cancelled',
        stage: 'تم إلغاء المهمة',
        isRendering: false,
        engine: prev.engine,
      }));
      try { window.localStorage.removeItem(PERSISTED_JOB_KEY); } catch { /* optional persistence */ }
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
      try { window.localStorage.setItem(PERSISTED_JOB_KEY, job.id); } catch { /* optional persistence */ }
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
        engine: job.engine || prev.engine,
        queuePosition: 0,
        etaSeconds: 0,
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
