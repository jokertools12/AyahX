/** Share startup and readiness initialization; a failed attempt never becomes a cached success. */
export function createRuntimeInitialization(check: () => Promise<void>, initialize: () => Promise<void>) {
  let initialized = false;
  let pending: Promise<void> | null = null;
  return async () => {
    await check();
    if (initialized) return;
    if (!pending) pending = initialize().then(() => { initialized = true; }).catch(error => { pending = null; throw error; });
    await pending;
  };
}
