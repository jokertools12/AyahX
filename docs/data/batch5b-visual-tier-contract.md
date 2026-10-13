# Batch 5b visual scheduling contract

This contract implements the owner's 13 October resumption. Thresholds are unchanged. Unit fixtures validate scheduling and evidence structure; they do not claim real browser acceptance.

Tier 1 blocks admin shipping: every source-derived route/tab view at the five combinations below, every declared dialog at desktop Arabic light 100% and mobile Arabic dark 150%, and the five core pages at 200%. The 200% checks use all five launch size/language/theme combinations.

| Window | Language | Theme | Native zoom |
|---|---|---|---|
| 1366×768 | Arabic | Light | 100% |
| 1366×768 | Arabic | Dark | 150% |
| 390×844 | Arabic | Light | 100% |
| 390×844 | Arabic | Dark | 150% |
| 1920×1080 | English | Light | 125% |

Core pages: home, review detail, listening, reciters, availability. Current source has 34 logical views and 21 declared dialogs: 195 page measurements plus at least 42 dialog measurements = 237. New source views and dialogs are automatically inventoried, including after the owner tools are added. A dialog already measured in this same run/shard at the identical combination is referenced rather than re-opened on every route; the aggregate requires its actual matching direct proof. Failure cannot be replaced by an earlier run.

Tier 2 blocks public catalog opening, not admin shipping. The four windows × four native zooms (100/125/150/200) × both languages × both themes remain 64 combinations per view, currently 2176 pages. Applicable dialogs retain full measurement. The local post-shipment background run has no default time budget. An explicit budget stops with incomplete evidence and a nonzero exit; no partial shard can publish `passed=true`.

Two actor-owned fixture accounts, profiles and route shards are preserved. The aggregate checks source inventories, exact case identities/dimensions, per-case evidence, native DPR, scanner/axe direct proofs, every required dialog in both launch combinations, review state and all error channels. Only the aggregate may publish launch/full acceptance. Failed children retain sanitized progress and expected/measured/failed counts.

Root runs the restored local Tier 1 with `CI=true`, `AYAHX_ADMIN_VISUAL_CI=1`, `AYAHX_ADMIN_VISUAL_TIER=tier1`, `AYAHX_ADMIN_VISUAL_BASE=http://localhost:3005`, `AYAHX_ADMIN_VISUAL_REDIS_DB=13` and an absolute `AYAHX_ADMIN_CI_PRIVATE_DIR` outside Git. The private `fixture.json` contains two distinct `shardActors` and may declare `seedProofSource=restored-private-backup`. Root alone prepares actors and fixtures, verifies protected counts/checksums before/after, starts the actual local server and invokes `node scripts/admin-visual-ci-all.mjs`. Defaults are loopback `http://127.0.0.1:3005` and Redis DB15 for disposable CI. External origins and database environment are rejected; no production browser path is supported.

GitHub PR runs Tier 1 with a 40-minute job; manual/weekly runs Tier 2 with a 60-minute job. Browser budgets are 35/55 minutes to leave report/cleanup time. The workflow does not run on push. A long hosted run remains disabled until root records repository visibility, plan and minutes and sets the nonsecret repository variable `ADMIN_VISUAL_BILLING_APPROVED=true`. Public repositories are supported after this verification; the workflow does not change repository visibility. Hosted Tier 2 may honestly remain incomplete inside its budget; completion must not be inferred or thresholds lowered. Raw logs, fixture credentials and browser profiles are excluded from artifact paths.

Actual duration, Tier 1 success, hosted billing approval and real Tier 2 results remain root-owned live verification gates.
