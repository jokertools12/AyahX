/**
 * Railway uses the same container image for the API and the isolated render
 * workers. A worker declares RENDER_WORKER_ENGINE; the public API does not.
 * Keeping this decision in the image itself makes deployments safe even when
 * Railway falls back to the Docker CMD instead of the service start command.
 */
if (process.env.RENDER_WORKER_ENGINE) {
  await import('./worker');
} else {
  await import('./index');
}
