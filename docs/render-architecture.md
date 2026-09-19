# AyahX render architecture v2

The API accepts a validated `RenderManifest`, writes the durable `render_jobs`
row in MySQL, and puts only `{ jobId }` on BullMQ. MySQL is the source of
truth; Redis is a delivery mechanism and can be rebuilt by `render-control`.

There are three independent pools:

| Engine | Queue | Railway service | Browser allowed |
| --- | --- | --- | --- |
| FFmpeg ASS | `quran-render-ffmpeg-v2` | `render-worker-ffmpeg` | No |
| Skia Canvas | `quran-render-skia-v2` | `render-worker-skia` | No |
| Browser Cloud | `quran-render-browser-v2` | `render-worker-browser` | Yes |

Each BullMQ task starts one isolated `server/renderChild.ts` process. The
worker supervisor remains responsible for Redis locks and admission control;
the child owns FFmpeg, Skia, or Chromium. A cancellation is persisted in
MySQL, and the child notices the lost running lease on its next heartbeat even
when the API request was handled by another replica.

## Capacity

Capacity is calculated from cgroup v2/v1 limits and current memory. The
profiles are conservative starting points, not a promise that a 100 MB limit
is safe:

- FFmpeg ASS: 256 MB/job, 1 CPU/job, 512 MB reserve.
- Skia: 512 MB/job, 1.5 CPU/job, 512 MB reserve.
- Browser Cloud: 900 MB/job, 2 CPU/job, 512 MB reserve.

The profile is scaled for output pixels, FPS, duration, and animated
backgrounds. An observed cgroup OOM halves the worker concurrency for five
minutes, then reopens capacity only after three safe readings.

`render-control` stores the current replica and slot estimate in
`render_engine_capacity`. The Railway autoscaler reads durable MySQL queue
counts and independently scales only the engine whose own work exceeds its
slots. It never moves a job between engines or lets Browser Cloud consume
native-worker capacity. Prometheus exposes replicas, total/used slots, queue
depth, p50/p95/max wait, oldest waiting age, classified failures, and
per-child CPU/RSS samples. Worker cgroup measurements remain separate and are
used only by the capacity governor, so concurrent jobs do not contaminate the
per-job profile sample.

## Delivery and recovery

`render-control` reconciles queued MySQL rows every 15 seconds, reclaims a
running job without a heartbeat for 90 seconds, and runs the bounded janitor.
Completed MP4 files are probed before success and uploaded to the configured
Railway bucket under `renders/{userId}/{jobId}.mp4`; downloads remain
same-origin and authenticated.

## Local commands

```text
npm test -- --run
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.node.json
npm run build
npm run bench:render
```

The benchmark is intentionally opt-in and configurable. Use
`BENCH_ENGINES=ffmpeg_ass,skia_canvas,browser_cloud` and
`BENCH_DURATIONS=15,60,300` in a staging environment; it writes JSON results
with wall time, child CPU usage, peak RSS/cgroup memory, and file size.
