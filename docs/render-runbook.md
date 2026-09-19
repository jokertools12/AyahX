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

The autoscaler is deliberately disabled until a staging run proves the
Railway API token scope and scale-down drain behavior. Fixed replicas are safer
than a scaler that can kill an active export. Enable it only with an explicit
`RAILWAY_AUTOSCALER_ENABLED=true`, a least-privilege token, and a tested
`MAX_REPLICAS`.
