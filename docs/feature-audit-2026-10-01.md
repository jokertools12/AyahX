# Settings, media providers and idle cost audit

## Verified locally

- 389 tests pass across 62 suites. The six database queue integration cases
  require `RUN_DB_INTEGRATION_TESTS=true` and an isolated MySQL test database;
  they were not run against production or counted as passes.
- The display audit renders 195 individual choices at four timestamps and
  checks that each choice produces different pixels within its option group.
  It also renders all 40 layout/animation combinations: 235 cases total.
- The full suite renders actual MP4s through FFmpeg, native Skia and Chromium,
  covering audio processing, layouts, image/slideshow backgrounds and routing.
- TypeScript application checking and the production frontend build pass.

## Corrections

- Pexels sends the login token, reads the configured server key, selects MP4
  sources, reports provider failures, ignores stale searches and follows the
  chosen video orientation. Completing a proxy request body no longer aborts
  the upstream video stream.
- All 16 Arabic font families are bundled with their OFL licenses and loaded
  locally by both native and browser renderers. Shadow intensity is applied.
  Disabled logos stay disabled; empty subtitles stay empty.
- Removed the display/production summary card.
- Image generation sends the selected aspect ratio/style to one configured
  Gemini model, uses a request deadline shorter than the client deadline, and
  returns structured quota/permission/empty-result errors. It does not retry
  four billed models or claim success without an image.
- Logo generation uses the selected text provider and validates SVG content;
  a procedural template is no longer mislabeled as an AI-generated result.
- AI image/logo requests have a smaller shared rate limit. Redis rate-limit
  buckets no longer collide between policies with different limits/windows.

## Live provider limitation

The configured Pexels key returned actual videos (HTTP 200). Gemini model
listing works, but actual image generation returned HTTP 429 on all four
previously attempted image models. Code changes cannot supply missing provider
quota. A successful live AI image remains unverified until the account has
available image quota; no provider or paid plan was changed automatically.

## Railway cost controls

All eight staging services were stopped; staging watch patterns prevent a
routine repository push from restarting them. Persistent staging volumes are
retained and may still incur storage charges.

Production API sleeping is enabled. API periodic maintenance moves to the
dedicated control process and idle MySQL connections close promptly. This
setting still needs live sleep/wake verification after deployment. Queue
workers, MySQL and Redis remain available for durable background processing;
API sleeping does not make the entire project free while idle.
