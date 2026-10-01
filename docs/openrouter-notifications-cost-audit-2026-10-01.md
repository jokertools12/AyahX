# Image generation, notifications and idle memory audit

## Image generation

The live OpenRouter catalogs and its official image guide were checked on
2026-10-01. No image output model has a free tier. A free vision/text model
cannot substitute for an image generator. Image dispatch now supports
OpenRouter with a strict free-only catalog and zero-price routing gate;
without an eligible model it returns `AI_IMAGE_FREE_MODEL_UNAVAILABLE`
without a billed generation call. Provider/model names are absent from the
customer-facing background and logo controls and image responses.

## Notifications

The old `max-h-80` ScrollArea did not constrain the viewport to a scrollable
height. The replacement has a bounded native scroll region, mobile width,
accessible controls, explicit loading/retry states and 30-item pagination.
Older notifications can be loaded without the former 50-item ceiling.
The misleading delete button only marked a notification read, so it was
removed; reading remains persisted. Polling does not replace loaded history
while open and pauses when hidden or idle for one minute.

## Memory and sleep

Live process inspection found the API running a TypeScript wrapper (~49 MB),
its loader/compiler helper (~16 MB), and the actual server (~195 MB RSS).
Production server entrypoints now compile once to CommonJS and run directly
with Node. API, control, worker and render children can avoid those helpers.
RSS includes shared pages and is not identical to Railway billed container RAM.
Redis TCP keepalive is explicitly disabled; API periodic DB maintenance was
already moved to control, and idle MySQL pool connections already close.
Frontend timer audit found notification polling as the recurring idle API
request; preview clocks and recording watchdogs operate locally.

24-hour Railway measurements before this deployment: MySQL mean 0.395 GB
(current 0.300); API mean 0.282 GB; Skia mean 0.179 GB; control mean 0.112 GB;
alignment mean 0.040 GB. This is a persistent multi-service baseline, not
evidence of a runaway leak. Database, queue and background consumers must
remain reachable to accept queued work. Reducing their memory limit alone
does not reduce actual RAM use and risks OOM failures.

Validation: app type-check and production build passed; full test suite
399 passed, 6 integration cases skipped because they require an isolated DB.
Notification pagination and free-only/no-paid-fallback regression tests passed.
Live generation cannot be called successful until a free image model exists.

## Verified idle connection corrections

Network logs showed continuous packets to the object-storage endpoint after
HTTP requests ended, plus Redis keepalive traffic. Request-only API storage
agents now close connections after each transfer. Queue producer and limiter
Redis connections close after 60 seconds idle and reconnect on demand; active
enqueues and worker consumers remain protected. A real local HTTP socket test
checks storage closure, and queue tests cover idle closure and closing races.
MySQL now uses a verified 64 MiB buffer pool with a 16 MiB chunk size.

Final local validation: 406 tests passed, 6 isolated-DB cases skipped;
production build and app type-check passed. Physical Railway sleep and wake
are verified separately after production deployment, not inferred from settings.
