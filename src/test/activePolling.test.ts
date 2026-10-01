import { afterEach, expect, it, vi } from 'vitest';
import { startActivePolling } from '../lib/activePolling';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('stops idle notification requests and refreshes when the user returns', () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const request = vi.fn(); const stop = startActivePolling(request);
  vi.advanceTimersByTime(120000); expect(request).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(600000); expect(request).toHaveBeenCalledTimes(4);
  window.dispatchEvent(new Event('keydown')); expect(request).toHaveBeenCalledTimes(5);
  stop(); vi.advanceTimersByTime(60000); expect(request).toHaveBeenCalledTimes(5);
});
it('never polls a hidden tab and refreshes on visibility change', () => {
  vi.useFakeTimers(); let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const request = vi.fn(); const stop = startActivePolling(request);
  vi.advanceTimersByTime(90000); expect(request).not.toHaveBeenCalled();
  hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  expect(request).toHaveBeenCalledOnce(); stop();
});
