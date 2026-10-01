/** Poll only while a person is using the page, so an idle tab cannot keep the
 * API awake indefinitely. Returning to the tab refreshes immediately. */
export function startActivePolling(callback: () => void, intervalMs = 30000, idleMs = 120000): () => void {
  let lastActivity = Date.now();
  let lastPoll = Number.NEGATIVE_INFINITY;
  const poll = () => {
    if (document.hidden || Date.now() - lastActivity >= idleMs || Date.now() - lastPoll < 5000) return;
    lastPoll = Date.now(); callback();
  };
  const activity = () => {
    const wasIdle = Date.now() - lastActivity >= idleMs;
    lastActivity = Date.now();
    if (wasIdle) poll();
  };
  const visible = () => { if (!document.hidden) { lastActivity = Date.now(); poll(); } };
  poll();
  const timer = setInterval(poll, intervalMs);
  window.addEventListener('pointerdown', activity);
  window.addEventListener('keydown', activity);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pointerdown', activity);
    window.removeEventListener('keydown', activity);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
