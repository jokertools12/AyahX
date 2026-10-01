# Rendering cost policy

Applied 2026-10-01 to AyahX production on Railway.

## Product limits

| Plan | Cloud videos/day (all engines combined) | Maximum duration | Resolution | FPS |
| --- | ---: | ---: | --- | ---: |
| Free | 1 | 120 seconds | 720p | 30 |
| Monthly | 5 | 300 seconds | 1080p | 30 |
| Yearly | 10 | 300 seconds | 1080p | 30 |

Local recording keeps its existing limits and paid 4K/60 FPS options. Cloud admission validates duration (including slowed audio), dimensions, FPS, enabled engine, daily quota and queue backlog before scheduling work. The shared daily counter is locked inside the same database transaction as admission. Idempotent requests do not consume additional slots. Disabled engines are not substituted automatically.

## Infrastructure target

- One API replica and one Skia worker, one job at a time.
- Skia: 2 vCPU / 2 GB maximum, FFmpeg encoding preset `veryfast`, one encoding thread, 64 MB asset cache.
- FFmpeg and Chromium workers stopped; Git auto-deploy watch patterns restricted to `/diagnostics-only/**` to keep them stopped during normal releases. Keep their configurations for explicit diagnostic reactivation.
- Autoscaling disabled; API queue capacity uses configured replica counts rather than historical autoscaler rows.
- Maximum backlog: 50 jobs. One active render per account remains enforced.
- MySQL: 128 MB buffer pool and 60 connections; persistent data retained. API connection pool 5 and Skia pool 3.
- Redis, render control, object storage and alignment service remain available for queues, cleanup and timing workflows.

Railway has both legacy `numReplicas` and regional replica settings. Align both for active services and verify actual running replicas after a deployment. `redeploy` can reuse the old deployment configuration; a fresh service deployment is required to verify changed MySQL startup options.

## Validation

Local build and TypeScript check passed. Policy, manifest, entitlement, capacity and export UI tests passed (53 tests); account settings tests passed (3 tests).

Real Railway visual QA generated MP4s, checked H.264 dimensions/audio and compared Arabic text, effects, decorations and lyric scenes across all three engines. On the tested still scenes, FFmpeg/Skia SSIM was 1.0; native/browser SSIM was 0.986912 for Quran and 0.975914 for lyrics. These short synthetic-audio fixtures verify render behavior; they do not estimate production throughput or cost per video, nor cover every background/effect combination.

Local artifacts: `qa-output/railway-cost-baseline/skia.mp4`, `comparison.jpg`, `lyrics-comparison.jpg`. These generated artifacts are not committed.

The live public API smoke test also passed: over-duration, resolution and FPS requests returned 403; disabled FFmpeg returned 503; an idempotent replay returned the original job; the first Skia submission completed and downloaded successfully; a second free-plan submission returned 403 with `quotaExceeded`. The disposable QA account was deleted after testing. The downloaded 316,872-byte MP4 decoded successfully, with 150 H.264 frames at 720x1280 / 30 FPS and AAC audio, lasting 5.02 seconds. The fixture used static verse text and real EveryAyah audio; no unverified word alignment was represented as approved. Report: `qa-output/railway-cost-baseline/api-smoke.json`.

A separate bounded benchmark on the actual 2 GB Skia worker rendered 30 seconds at 1080x1920 / 30 FPS in 26.08 seconds, using 44.14 CPU-seconds and a reported cgroup memory peak of 610,041,856 bytes (about 582 MiB). Its 679,088-byte artifact passed the renderer's media validation. This synthetic still-background workload is a capacity sanity check, not a forecast for complex backgrounds or five-minute videos.

MySQL runtime verification confirmed `innodb_buffer_pool_size=134217728` and `max_connections=60`. Settled Railway health confirmed one running API replica, one running Skia replica, and both diagnostic engines offline. Verify health again after each subsequent release.

## Cost interpretation and operations

The earlier $13.11 usage included idle infrastructure and engine experiments. Removing idle workers and duplicate replicas reduces ongoing resource consumption, but does not refund past usage. A fixed monthly bill or a percentage saving is not promised. Measure the following day's resource usage and a representative full-duration workload before pricing user video allowances or increasing concurrency. Hundreds of accounts do not imply hundreds of simultaneous render slots: this configuration queues their work and has limited throughput.

To reactivate a diagnostic engine, explicitly enable its API flag, restore its deployment watch patterns and worker deployment, and set both replica fields consistently. Recheck queue capacity and resource budgets before enabling autoscaling. Cloud quota rules live in `shared/planEntitlements.ts`; admission limits live in `shared/cloudRenderPolicy.ts`. Update product copy and UI tests whenever changing these rules.
