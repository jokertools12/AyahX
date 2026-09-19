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

Set `RENDER_ALERT_WEBHOOK_URL` only on `render-control` to receive threshold
alerts for queue p95/oldest age, OOMs, failure rate, and MAX_REPLICAS. The
webhook is optional and never blocks a render or changes queue state.
