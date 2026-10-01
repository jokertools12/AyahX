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
  it('stops owned recording clones while preserving audio for subsequent exports', async () => {
    vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('MediaStream', Stream);
    const owned = { stop: vi.fn() }, source = { stop: vi.fn(), clone: vi.fn(() => owned) };
    const canvas = { captureStream: () => ({ getVideoTracks: () => [{ stop: vi.fn(), requestFrame: vi.fn() }] }) } as unknown as HTMLCanvasElement;
    const audio = { getAudioTracks: () => [source] } as unknown as MediaStream;
    const { result } = renderHook(() => useVideoRecorder());
    for (let attempt = 0; attempt < 2; attempt++) await act(async () => {
      const recording = result.current.startRecording(canvas, null, 2, audio);
      result.current.stopRecording(); await recording;
    });
    expect(source.clone).toHaveBeenCalledTimes(2);
    expect(owned.stop).toHaveBeenCalledTimes(2);
    expect(source.stop).not.toHaveBeenCalled();
  });
  it.each([{fps:60 as const,audioBitrate:'320k' as const}, {fps:30 as const,audioBitrate:'128k' as const}])(
    'converts using recorded $fps fps / $audioBitrate locally', async ({fps,audioBitrate}) => {
      vi.stubGlobal('MediaRecorder',Recorder);
      vi.stubGlobal('MediaStream',Stream);
      const mp4 = new Blob([new Uint8Array(1200)],{type:'video/mp4'});
      const fetchMock = vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new ArrayBuffer(1200)});
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
      expect(fetchMock).not.toHaveBeenCalled();
      expect(converted).toBe(mp4);
      expect(result.current.error).toBeNull();
      expect(result.current.convertProgress).toBe(100);
      expect(convertWebmToMp4).toHaveBeenCalledWith(expect.any(Blob),expect.objectContaining({fps,audioBitrate,filename:'test clip.mp4',durationSeconds:30}));
      await act(async()=>{ await result.current.convertToMp4(); });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(convertWebmToMp4).toHaveBeenCalledTimes(1);
    },
  );
});
