import { useRef, useState, useCallback } from 'react';
import { convertWebmToMp4 } from '@/lib/ffmpeg';
import fixWebmDuration from 'fix-webm-duration';
import type { AudioBitrate, ExportFps } from '../../shared/planEntitlements';

export type ExportQuality = 'medium' | 'high' | 'ultra';
export type RecordingStrategy = 'quality' | 'smooth' | 'compatibility';

export interface QualitySettings {
  label: string;
  resolution: string;
  bitrate: number;
  /** Actual canvas width for recording */
  canvasWidth: number;
  /** Actual canvas height for recording (portrait 9:16) */
  canvasHeight: number;
}

export interface RecordingOptions {
  strategy?: RecordingStrategy;
  bitrateMultiplier?: number;
  timesliceMs?: number;
  mimeTypeCandidates?: string[];
  captureStreamFps?: number;
  startAtSeconds?: number;
  audioBitrate?: AudioBitrate;
  /** Re-encode native MP4 too, so requested CFR/FPS/audio settings are real. */
  forceMp4Transcode?: boolean;
}

export const QUALITY_PRESETS: Record<ExportQuality, QualitySettings> = {
  medium: { label: '720p HD',               resolution: '720×1280',     bitrate: 4_000_000,   canvasWidth: 720,  canvasHeight: 1280 },
  high:   { label: '1080p Full HD',          resolution: '1080×1920',    bitrate: 8_000_000,   canvasWidth: 1080, canvasHeight: 1920 },
  ultra:  { label: '4K Ultra HD',            resolution: '2160×3840',    bitrate: 18_000_000, canvasWidth: 2160, canvasHeight: 3840 },
};

/** Return recording canvas dimensions for the given quality + aspect ratio */
export function getQualityDimensions(quality: ExportQuality, aspectRatio: '9:16' | '16:9') {
  const preset = QUALITY_PRESETS[quality];
  if (aspectRatio === '16:9') {
    return { width: preset.canvasHeight, height: preset.canvasWidth }; // swap
  }
  return { width: preset.canvasWidth, height: preset.canvasHeight };
}

export interface VideoRecorderState {
  isRecording: boolean;
  progress: number;
  videoBlob: Blob | null;
  mp4Blob: Blob | null;
  isConverting: boolean;
  convertProgress: number;
  error: string | null;
  stage: string;
}

export function useVideoRecorder() {
  const [state, setState] = useState<VideoRecorderState>({
    isRecording: false,
    progress: 0,
    videoBlob: null,
    mp4Blob: null,
    isConverting: false,
    convertProgress: 0,
    error: null,
    stage: '',
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const conversionInProgressRef = useRef<boolean>(false);
  const mp4BlobRef = useRef<Blob | null>(null);
  const videoBlobRef = useRef<Blob | null>(null);
  const recordingOutputRef = useRef<{ fps: ExportFps; audioBitrate: AudioBitrate; durationSeconds?: number }>({
    fps: 30,
    audioBitrate: '192k',
  });

  const videoTrackRef = useRef<CanvasCaptureMediaStreamTrack | null>(null);

  /** Call after each drawFrame() during recording to push the frame into the stream */
  const requestFrame = useCallback(() => {
    try {
      videoTrackRef.current?.requestFrame();
    } catch {
      // Ignore if track is disposed or not supported
    }
  }, []);

  const startRecording = useCallback(async (
    canvas: HTMLCanvasElement,
    audioElement: HTMLAudioElement | null,
    duration: number = 30,
    audioStream?: MediaStream | null,
    quality: ExportQuality = 'high',
    captureFps: ExportFps = 30,
    options?: RecordingOptions
  ): Promise<Blob | null> => {
    return new Promise((resolve, reject) => {
      try {
        const qualitySettings = QUALITY_PRESETS[quality];
        const strategy = options?.strategy ?? 'smooth';
        const bitrateMultiplier = Math.min(Math.max(options?.bitrateMultiplier ?? 1, 0.45), 1.2);
        
        setState({
          isRecording: true, progress: 0, videoBlob: null, mp4Blob: null,
          isConverting: false, convertProgress: 0, error: null,
          stage: 'جاري تجهيز التسجيل...',
        });
        chunksRef.current = [];
        conversionInProgressRef.current = false;
        videoBlobRef.current = null;
        mp4BlobRef.current = null;

        // Manual canvas capture is paced by PreviewPage's frame loop. Never
        // silently cap a paid 60fps export to 30fps.
        const safeFps: ExportFps = captureFps === 60 ? 60 : 30;
        const requestedAudioBitrate: AudioBitrate = options?.audioBitrate === '320k'
          ? '320k'
          : options?.audioBitrate === '128k'
          ? '128k'
          : '192k';
        recordingOutputRef.current = { fps: safeFps, audioBitrate: requestedAudioBitrate, durationSeconds: duration };

        // Use captureStream(0) = manual frame capture mode.
        // Frames are only pushed when we call videoTrack.requestFrame().
        // This eliminates dropped frames when canvas rendering is slow (e.g. heavy video backgrounds).
        const canvasStream = canvas.captureStream(0);
        const vTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        try { vTrack.contentHint = 'motion'; } catch { /* optional browser hint */ }
        videoTrackRef.current = vTrack;

        const tracks = [...canvasStream.getVideoTracks()];
        if (audioStream && audioStream.getAudioTracks().length) {
          tracks.push(...audioStream.getAudioTracks().map(track => track.clone()));
        } else if (audioElement) {
          const anyAudio = audioElement as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
          const elStream = anyAudio.captureStream?.() ?? anyAudio.mozCaptureStream?.();
          if (elStream?.getAudioTracks().length) {
            tracks.push(...elStream.getAudioTracks().map(track => track.clone()));
          }
        }
        const combinedStream = new MediaStream(tracks);

        const stopTracks = () => {
          combinedStream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {
              // Ignore track stop errors during cleanup
            }
          });
        };

        // Prefer hardware-accelerated MP4 if supported, else VP9/VP8 WebM
        const defaultCandidates = strategy === 'quality'
          ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
          : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
        const mimeCandidates = options?.mimeTypeCandidates?.length ? options.mimeTypeCandidates : defaultCandidates;
        const resolvedMime = mimeCandidates.find((c) => {
          try {
            return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c);
          } catch {
            return false;
          }
        });
        const mimeType = resolvedMime || 'video/webm';

        const safeBitrate = Math.max(1_500_000, Math.round(qualitySettings.bitrate * Math.max(bitrateMultiplier, 0.85)));

        const recorderOptions: MediaRecorderOptions = {
          videoBitsPerSecond: safeBitrate,
          audioBitsPerSecond: Number.parseInt(requestedAudioBitrate, 10) * 1000,
        };
        if (resolvedMime) recorderOptions.mimeType = resolvedMime;

        const mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };

        // The recording clock starts at the same moment as MediaRecorder so
        // any play() scheduling delay cannot shorten the captured duration.
        let startTime = Date.now();
        let progressIntervalId: number | null = null;
        let lastProgressStep = -1;

        mediaRecorder.onstop = async () => {
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          if (progressIntervalId !== null) { window.clearInterval(progressIntervalId); progressIntervalId = null; }

          const rawBlob = new Blob(chunksRef.current, { type: mimeType });
          const elapsed = Date.now() - startTime;
          let blob: Blob;
          const isNativeMp4 = mimeType.includes('mp4');
          const forceMp4Transcode = options?.forceMp4Transcode !== false;
          if (isNativeMp4) {
            blob = rawBlob;
            if (!forceMp4Transcode) mp4BlobRef.current = rawBlob;
          } else {
            try { blob = await fixWebmDuration(rawBlob, elapsed, { logger: false }); } catch { blob = rawBlob; }
          }
          videoBlobRef.current = blob;

          setState((prev) => ({
            ...prev, isRecording: false, progress: 100, videoBlob: blob,
            mp4Blob: isNativeMp4 && !forceMp4Transcode ? blob : null, isConverting: false, convertProgress: 0, error: null, stage: 'جاهز لتجهيز MP4',
          }));
          stopTracks();
          resolve(blob);
        };

        mediaRecorder.onerror = (e) => {
          if (progressIntervalId !== null) { window.clearInterval(progressIntervalId); progressIntervalId = null; }
          console.error('MediaRecorder error:', e);
          stopTracks();
          setState((prev) => ({ ...prev, isRecording: false, error: 'حدث خطأ في التسجيل' }));
          reject(new Error('Recording failed'));
        };

        // Larger timeslice = fewer interruptions = less jank
        const chunkIntervalMs = Math.min(Math.max(options?.timesliceMs ?? 2000, 500), 5000);
        setState((prev) => ({ ...prev, stage: 'جاري بدء التسجيل...' }));

        const startAt = (options as any)?.startAtSeconds ?? 0;
        let isStopping = false;

        const finishRecording = () => {
          if (isStopping) return;
          isStopping = true;
          if (progressIntervalId !== null) {
            window.clearInterval(progressIntervalId);
            progressIntervalId = null;
          }
          // 150ms acoustic decay margin to capture final recitation reverb without harsh cut
          window.setTimeout(() => {
            try {
              if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
              }
            } catch (err) {
              console.warn('Error stopping mediaRecorder:', err);
            }
            if (audioElement) {
              try {
                audioElement.pause();
              } catch {
                // A detached or already-paused media element needs no
                // recovery; the recorder still completes normally.
              }
            }
          }, 150);
        };

        // Start the recorder before asking the media element to play.  This
        // prevents the first audio samples from preceding the first video
        // frame, while the captured audio clock still drives completion.
        const beginRecording = () => {
          startTime = Date.now();
          mediaRecorder.start(chunkIntervalMs);

          // Throttled progress — update every 500ms to reduce React re-renders
          progressIntervalId = window.setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const audioPos = audioElement && audioElement.duration > 0
              ? Math.max(audioElement.currentTime - startAt, 0)
              : elapsed;

            const progress = Math.min((audioPos / duration) * 100, 100);
            const progressStep = Math.round(progress);

            let stage = 'جاري التسجيل...';
            if (progress < 25) stage = 'جاري تسجيل الخلفية...';
            else if (progress < 50) stage = 'جاري تسجيل الصوت...';
            else if (progress < 75) stage = 'جاري معالجة الآيات...';
            else stage = 'جاري إنهاء الفيديو...';

            if (progressStep !== lastProgressStep) {
              lastProgressStep = progressStep;
              setState((prev) => ({ ...prev, progress, stage }));
            }

            // Audio-driven completion detection with safety fallback
            const isAudioFinished = audioElement
              ? audioElement.ended || audioElement.currentTime >= (startAt + duration - 0.05)
              : false;

            if (isAudioFinished || elapsed >= duration + 0.5) {
              finishRecording();
            }
          }, 350);
        };

        if (audioElement) {
          beginRecording();
          audioElement.play()
            .catch((err) => {
              console.warn('Audio play warning; recording continues without playback:', err);
            });
        } else {
          beginRecording();
        }

      } catch (error) {
        console.error('Recording error:', error);
        setState({
          isRecording: false, progress: 0, videoBlob: null, mp4Blob: null,
          isConverting: false, convertProgress: 0,
          error: error instanceof Error ? error.message : 'حدث خطأ في التسجيل', stage: '',
        });
        reject(error);
      }
    });
  }, []);

  const convertToMp4 = useCallback(async (targetFilename: string = 'quran-reel.mp4'): Promise<Blob | null> => {
    if (mp4BlobRef.current) return mp4BlobRef.current;
    if (state.mp4Blob) return state.mp4Blob;
    const sourceVideo = videoBlobRef.current ?? state.videoBlob;
    if (!sourceVideo) return null;
    // Use the settings captured for this recording, not current UI selections.
    const { fps, audioBitrate, durationSeconds } = recordingOutputRef.current;

    if (conversionInProgressRef.current) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!conversionInProgressRef.current) { clearInterval(checkInterval); resolve(mp4BlobRef.current); }
        }, 300);
      });
    }

    try {
      conversionInProgressRef.current = true;
      setState((prev) => ({
        ...prev, isConverting: true, convertProgress: 0,
        stage: 'جاري تجهيز ملف MP4 على جهازك… أبقِ الصفحة مفتوحة', error: null,
      }));
      // On-device recording must never upload the video for cloud encoding.
      const mp4 = await convertWebmToMp4(sourceVideo, {
        filename: targetFilename, fps, audioBitrate, durationSeconds,
        onProgress: (ratio) => setState((prev) => ({
          ...prev, convertProgress: Math.round(Math.min(Math.max(ratio, 0), 1) * 100),
        })),
      });

      conversionInProgressRef.current = false;
      mp4BlobRef.current = mp4;
      setState((prev) => ({ ...prev, isConverting: false, mp4Blob: mp4, error: null, convertProgress: 100, stage: 'ملف MP4 جاهز للتنزيل والمشاركة' }));
      return mp4;
    } catch (e) {
      console.error('MP4 conversion failed:', e);
      conversionInProgressRef.current = false;
      setState((prev) => ({ ...prev, isConverting: false, error: 'فشل التحويل إلى MP4', stage: 'فشل التحويل' }));
      return null;
    }
  }, [state.videoBlob, state.mp4Blob]);

  const downloadMp4 = useCallback(async (filename: string = 'quran-reel.mp4') => {
    let blob = mp4BlobRef.current ?? state.mp4Blob;
    const sourceVideo = videoBlobRef.current ?? state.videoBlob;
    if (!blob && sourceVideo) {
      blob = await convertToMp4(filename);
    }
    if (!blob) {
      setState((prev) => ({
        ...prev,
        error: prev.isConverting || conversionInProgressRef.current ? null : 'ملف MP4 غير جاهز بعد',
        stage: prev.isConverting || conversionInProgressRef.current ? 'جاري تجهيز ملف MP4 على جهازك…' : 'MP4 غير متوفر بعد',
      }));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.mp4') ? filename : `${filename.replace(/\.[^/.]+$/, '')}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setState((prev) => ({ ...prev, stage: 'بدأ تنزيل ملف MP4 إلى جهازك', error: null }));
  }, [state.mp4Blob, state.videoBlob, convertToMp4]);

  const downloadWebm = useCallback((filename: string = 'quran-reel.webm') => {
    const blob = videoBlobRef.current ?? state.videoBlob;
    if (!blob) { setState((prev) => ({ ...prev, error: 'لا يوجد فيديو WebM للتحميل' })); return; }
    if (!blob.type.toLowerCase().includes('webm')) {
      setState((prev) => ({ ...prev, error: 'ملف WebM غير متاح؛ أعد التسجيل بعد اختيار صيغة WebM' }));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.webm') ? filename : `${filename.replace(/\.[^/.]+$/, '')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setState((prev) => ({ ...prev, stage: 'تم تحميل WebM!', error: null }));
  }, [state.videoBlob]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const reset = useCallback(() => {
    stopRecording();
    conversionInProgressRef.current = false;
    mp4BlobRef.current = null;
    videoBlobRef.current = null;
    setState({ isRecording: false, progress: 0, videoBlob: null, mp4Blob: null, isConverting: false, convertProgress: 0, error: null, stage: '' });
    chunksRef.current = [];
  }, [stopRecording]);

  return { ...state, startRecording, stopRecording, downloadMp4, downloadWebm, convertToMp4, reset, requestFrame };
}
