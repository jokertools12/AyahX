# Render v2 runbook

## Health checks

1. Check the API readiness endpoint.
2. Check `/internal/metrics` with `Authorization: Bearer $METRICS_TOKEN`.
3. Confirm exactly one healthy service per engine and that each log names its
   own v2 queue.
4. Check the Railway bucket and Redis volume before changing replicas.

## A failed render

Read `error_code` first. `USER_INPUT` and `ASSET` need a corrected manifest;
`TIMEOUT`, `ENGINE`, `STORAGE`, and `OOM_SUSPECTED` are eligible for bounded
automatic retry. A failed MP4 is never published as `succeeded`.

Workers keep a bounded local LRU cache for repeated remote audio and
background assets (`RENDER_ASSET_CACHE_MB`). It is disposable performance
state only: a cache miss downloads the asset again, and losing the cache never
loses a durable render job.

For `OOM_SUSPECTED`, keep the worker online: the governor reduces concurrency
without taking down unrelated engine pools. Inspect cgroup memory and
`quran_render_jobs_total` before changing profile values.

## Redis interruption

Do not manually recreate jobs. MySQL rows remain `queued`/`pending` and
`render-control` re-adds the stable BullMQ id after Redis returns. Redis is
configured with AOF, `everysec`, and `noeviction`.

## Deployment

Deploy in this order: database migration, control service, native workers,
browser worker, then API. Railway worker commands run Node directly through
the checked-in `tsx` entrypoint. During a rollout, leave the old v1 service
running until its queue is empty; v2 has already been proven with synthetic
parallel jobs. Never point an old worker at a v2 queue.

When enabled, the autoscaler runs only on `render-control`, never on API or
workers. It uses a Railway project token scoped to the production environment
and changes only the service belonging to the saturated engine. Scale-up is
immediate; scale-down waits for the idle window, requires zero active jobs, and
removes a single replica at a time. If the token or service ids are missing,
control falls back to fixed replicas without affecting rendering.

Required production variables are `RAILWAY_ENVIRONMENT_ID`, one
`*_RENDER_SERVICE_ID` per worker, `*_RENDER_SLOTS_PER_REPLICA`, min/max replica
limits, `RAILWAY_AUTOSCALER_TOKEN`, and `RAILWAY_AUTOSCALER_ENABLED=true`.

For staging admission/load tests, set `RENDER_SIMULATE=1` only on the staging
workers. The child process then simulates engine delay, CPU and bounded memory,
creates a tiny valid H.264/AAC fixture, and still exercises ffprobe, upload,
durable completion and download. Use `npm run load:render-submissions` with
100, 500, or 1000 staging tokens; never enable the simulator on production.
For a disposable staging account pool, `AUTH_RATE_LIMIT_MAX` may be raised only
in that staging API service. Production keeps the default of 20 attempts per
15 minutes and derives limiter identity from Express's trusted Railway proxy,
never directly from a client-supplied `X-Forwarded-For` value.

`npm run load:staging-renders` is the guarded end-to-end alternative. It only
accepts a hostname containing `staging` plus the explicit confirmation value
`CREATE_STAGING_RENDER_LOAD_ACCOUNTS`; it creates disposable staging accounts,
grants a staging-only yearly test subscription, sends the requested count to
the selected isolated engines, waits for all durable jobs, and ffprobes one
downloaded H.264/AAC/yuv420p artifact per engine. Supply the temporary MySQL
tunnel details through `STAGING_LOAD_DB_*`; it refuses production URLs.
After the run, use `npm run cleanup:staging-render-load` with
`STAGING_LOAD_CLEANUP_CONFIRM=DELETE_STAGING_RENDER_LOAD_DATA` and the staging
database/object-storage variables. The cleanup is independently guarded and
only targets the isolated staging bucket.

Set `RENDER_ALERT_WEBHOOK_URL` only on `render-control` to receive threshold
alerts for queue p95/oldest age, OOMs, failure rate, MAX_REPLICAS, Redis memory
over 70%, and MySQL pool usage over 80%. Set `REDIS_MEMORY_LIMIT_MB` when the
Redis service does not expose a `maxmemory` value. The webhook is optional and
never blocks a render or changes queue state.

The load runner uses `STAGING_LOAD_FETCH_TIMEOUT_MS` (default 30 seconds) and
prints `registered` and `admitted` phase markers. A temporary
`STAGING_LOAD_HOLD_AFTER_ADMISSION_MS` pause can be used when testing a worker
restart during active processing; unset both values for normal tests.
