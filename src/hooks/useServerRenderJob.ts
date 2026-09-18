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
  queuePosition: number | null;
}

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
    queuePosition: null,
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
    activeJobIdRef.current = null;
    consecutiveErrorsRef.current = 0;
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
      queuePosition: null,
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

          const { job: updatedJob, queuePosition } = await api.renderJobs.getJob(activeJobIdRef.current);
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
              queuePosition: null,
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
              queuePosition: null,
            }));
          } else if (currentStatus === 'cancelled') {
            stopPolling();
            setState((prev) => ({
              ...prev,
              status: 'cancelled',
              stage: 'تم إلغاء المهمة',
              isRendering: false,
              isCompleted: false,
              queuePosition: null,
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
                  ? 'في قائمة الانتظار - جاري انتظار اكتمال المهام السابقة...'
                  : 'جاري معالجة الفيديو وتوليد الإطارات...'),
              isRendering: true,
              isCompleted: false,
              queuePosition: currentStatus === 'queued' ? (queuePosition ?? null) : null,
            }));
          }
        } catch (pollErr: any) {
          console.warn('Render poll error:', pollErr);
          consecutiveErrorsRef.current++;
          if (consecutiveErrorsRef.current >= 4) {
            stopPolling();
            setState((prev) => ({
              ...prev,
              status: 'failed',
              stage: 'انقطع الاتصال بمهمة الريندر',
              error: 'تعذر متابعة حالة الريندر (قد تم إلغاء المهمة أو انتهت صلاحيتها). يمكنك بدء مهمة جديدة.',
              isRendering: false,
            }));
          }
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
      const res = await api.renderJobs.getActiveJob();
      if (res.hasActiveJob && res.job) {
        const job = res.job;
        activeJobIdRef.current = job.id;
        const progress = Math.min(100, Math.max(0, Number(job.progress) || 0));
        setState({
          jobId: job.id,
          status: job.status,
          progress,
          stage:
            job.stage ||
            (job.status === 'queued'
              ? 'في قائمة الانتظار - جاري انتظار اكتمال المهام السابقة...'
              : 'جاري معالجة الفيديو وتوليد الإطارات...'),
          error: null,
          outputFilename: job.output_filename || null,
          isRendering: true,
          isCompleted: false,
          videoBlob: null,
          queuePosition: res.queuePosition ?? null,
        });
        startPolling(job.id);
      } else if (res.recentJob) {
        const rJob = res.recentJob;
        activeJobIdRef.current = rJob.id;
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
          queuePosition: null,
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
   * By default, passes replaceActive: true to safely clear any previously queued or stale jobs.
   */
  const startServerRender = useCallback(
    async (
      manifest: any,
      idempotencyKey?: string,
      options?: { replaceActive?: boolean }
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
        queuePosition: null,
      });

      try {
        const { job } = await api.renderJobs.createJob(manifest, idempotencyKey, {
          replaceActive: options?.replaceActive ?? true,
        });
        const jobId = job.id;
        activeJobIdRef.current = jobId;

        setState((prev) => ({
          ...prev,
          jobId,
          status: job.status,
          progress: Number(job.progress) || 0,
          stage: job.stage || 'في قائمة الانتظار',
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
          queuePosition: null,
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
      setState((prev) => ({
        ...prev,
        jobId: job.id,
        status: job.status,
        progress: Number(job.progress) || 0,
        stage: job.stage || 'تمت إعادة المهمة إلى الطابور',
        error: null,
        isRendering: true,
        isCompleted: false,
        videoBlob: null,
        queuePosition: null,
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
