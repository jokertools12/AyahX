import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVideoRecorder } from '@/hooks/useVideoRecorder';
import { convertWebmToMp4 } from '@/lib/ffmpeg';

vi.mock('@/lib/ffmpeg', () => ({ convertWebmToMp4: vi.fn() }));
vi.mock('fix-webm-duration', () => ({ default: async (blob: Blob) => blob }));
class Recorder {
  static isTypeSupported(type: string) { return type.includes('webm'); }
  state = 'inactive';
  ondataavailable?: (event: {data: Blob}) => void;
  onstop?: () => Promise<void>;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({data:new Blob(['recorded-webm'],{type:'video/webm'})});
    void this.onstop?.();
  }
}
class Stream {
  constructor(private tracks: unknown[] = []) {}
  getTracks() { return this.tracks; }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('recorded output settings survive MP4 conversion', () => {
  it.each([{fps:60 as const,audioBitrate:'320k' as const,fallback:false}, {fps:30 as const,audioBitrate:'128k' as const,fallback:true}])(
    'converts using recorded $fps fps / $audioBitrate, fallback=$fallback', async ({fps,audioBitrate,fallback}) => {
      vi.stubGlobal('MediaRecorder',Recorder);
      vi.stubGlobal('MediaStream',Stream);
      const mp4 = new Blob([new Uint8Array(1200)],{type:'video/mp4'});
      const fetchMock = vi.fn().mockResolvedValue({ok:!fallback,arrayBuffer:async()=>new ArrayBuffer(1200)});
      vi.stubGlobal('fetch',fetchMock);
      vi.mocked(convertWebmToMp4).mockResolvedValue(mp4);
      const canvas = {captureStream:()=>({getVideoTracks:()=>[{stop:vi.fn(),requestFrame:vi.fn()}]})} as unknown as HTMLCanvasElement;
      const {result} = renderHook(()=>useVideoRecorder());
      let recording: Promise<Blob | null>;
      await act(async()=>{
        recording = result.current.startRecording(canvas,null,30,null,'high',fps,{audioBitrate});
        result.current.stopRecording();
        await recording;
      });
      let converted: Blob | null = null;
      await act(async()=>{ converted=await result.current.convertToMp4('test clip.mp4'); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/videos/process-mp4?fps=${fps}&audioBitrate=${audioBitrate}&filename=test%20clip.mp4`);
      expect(converted).not.toBeNull();
      expect(result.current.error).toBeNull();
      if (fallback) expect(convertWebmToMp4).toHaveBeenCalledWith(expect.any(Blob),expect.objectContaining({fps,audioBitrate,filename:'test clip.mp4'}));
      else expect(convertWebmToMp4).not.toHaveBeenCalled();
      await act(async()=>{ await result.current.convertToMp4(); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
