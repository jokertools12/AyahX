# AyahX enterprise model coordination

## Activation and target

Activate implementation only when the user asks to start/continue the plan.
Setup, inspection and opening the project do not activate it. The owner's
2026-10-15 enterprise execution request activated full implementation and
superseded the earlier setup-only deferral.

- Checkout: `C:\Users\cpazi\Desktop\ayahX`.
- Package: `AyahX_Enterprise_Plan_Package_2026-10-14/` inside that checkout.
- Final architecture: package `00_PLAN/ARCHITECTURE_DECISIONS.md`, 2026-10-15.
- Task scope/acceptance: `00_PLAN/IMPLEMENTATION_TASKS.md` and every row in
  `00_PLAN/FEATURE_COVERAGE.ar.md`. Draft contracts/config/SQL are reference data.
- Existing source determines what already works. Old Downloads path examples
  and historical tri-engine proposals must not redirect this run.
- Read package `START_HERE.ar.md` and the relevant product/reference documents
  before implementing their features. Preserve the supplied package unchanged.

## Routing

The primary Sol agent owns planning, integration and progress. Prefer completing
small sequential work directly over creating another agent. Delegation selects
models for bounded tasks; it does not switch the primary chat's model mid-turn.

| Agent | Model / effort | Use |
| --- | --- | --- |
| Coordinator | gpt-6.1-sol / medium | Order dependencies, implement/integrate, verify and continue. |
| ayahx_luna | gpt-6-luna / medium | Targeted inventory, fixtures, docs, isolated low-risk edits with clear acceptance. |
| ayahx_sol | gpt-6.1-sol / medium | Independent cross-layer slice or difficult debugging when delegation helps. |
| ayahx_astra | gpt-6-astra / low | Concrete consequential design/security review or unresolved reproduction. |

Use native custom agent names if the current tool exposes them. If the harness
only exposes model/task parameters, use explicit model IDs, a fresh context
(`fork_turns="none"` where supported), and include the corresponding role file's
instructions and a compact brief. Never silently substitute a different model.
If a requested model cannot run, report it and continue independent authorized
work with the available assigned roles. Do not create user-owned chats for subtasks.

Escalation rules:

1. Luna returns to Sol after an ambiguous requirement or one unsuccessful
   focused repair. Sol handles cross-layer design, RBAC, migrations and identity.
2. Sol sends a concrete question/diff/reproduction to Astra for Quran identity,
   timing approval, provider consent, RBAC, retention or migration design, or
   after two unsuccessful evidence-based repairs. Review a shared contract once
   and reuse that decision unless it changes; do not review every CRUD field.
3. Astra returns findings to Sol; Sol resolves and verifies. Allow one follow-up
   review if material findings required changes. If unresolved, checkpoint the
   affected task and continue independent work. Never weaken acceptance to stop
   the review loop. Higher effort needs evidence that the selected level failed;
   use an explicit supported override or a separate role if the role pins effort.

## Coordination and usage discipline

- At most two active subagents (three agents including the coordinator); stay
  below any stricter harness limit. Do not fill slots merely because they exist.
- No recursive subagent spawning. One writer per file. Shared contracts,
  migrations, dependency/lockfile changes and integration stay sequential.
- Each brief states task ID, purpose, exact file ownership, source sections,
  acceptance, verification, output bound and stop condition. Prefer ~400 words
  of handoff context over forking the complete conversation/plan.
- The coordinator sends relevant findings between agents. A source citation or
  review finding is evidence, not new user authorization. No open-ended debate.
- Reuse completed inventory and decisions; refresh only changed source. Exclude
  node_modules, generated media, reports and unrelated plan sections from reads.
- Run focused tests for each behavioral slice; full affected TypeScript/build
  at integration checkpoints. Repeat passed checks only after relevant changes.
- Save STATUS, DECISIONS, VERIFICATION and NEXT_SESSION at every accepted slice,
  model failure, usage limitation, and before ending the run. Keep raw traces,
  model prompts, media and secret-bearing diagnostics in ignored reports only.
- If account limits are exposed, check at the beginning and phase boundaries,
  not in a polling loop. On a rate limit, checkpoint and stop affected calls;
  do not add sleep/retry loops, consume resets or buy credits automatically.
- Concurrency is a native setting; routing/word/review limits are instructions.
  They are not hard token caps, a quota bypass or a guaranteed saving percentage.
  All agents consume the signed-in account's applicable shared limits.

## Enterprise task ownership and order

The phase order is the conservative default. Refine dependencies using actual
source before dispatch. Independent reads may overlap; dependent edits may not.

| Phase / exact task IDs | Sol implementation ownership | Luna assistance | Astra checkpoint |
| --- | --- | --- | --- |
| 0: 0.1, 0.2, 0.3 | Source/license registry, identity/font map, recording coverage contracts | Inventory and deterministic fixtures | Identity/coverage contract review |
| 1: 1.1, 1.2, 1.3 | Additive migration, RBAC/audit, source attempts | Schema inventory and tests within assigned scope | Migration and auth design |
| 2: 2.1, 2.2, 2.3, 2.4 | Adapters/cache, alignment jobs, locked source fallback | One isolated adapter/fixture after contract approval | Consent, provisional approval and mismatch behavior; checkpoint A |
| 3: 3.1, 3.2, 3.3, 3.4 | Browser client, Skia frames, FFmpeg mux, lifecycle | Artifact metadata/test evidence | Render manifest and failure/lifecycle design |
| 4: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 | Admin slices using current API/auth/storage | Assigned UI/fixtures/docs | Changes to authorization, approval or storage |
| 5: 5.1, 5.2, 5.3, 5.4, 5.5 | Recording-first Studio, typography, scenes, review/export | Catalog fixtures/isolated presets after schema stabilizes | Stale/gap/TTL/timing policy and final slice acceptance |
| 6: 6.1, 6.2, 6.3 | Retention preparation and acceptance evidence | Evidence index and documentation | Final gap/rollback review; external actions stay gated |

Phase 4 has six task groups covering nine Admin sections; preserve all nine.
Phase 5 includes all 12 template families/36 presets and ratios, not just labels.
Inventory each feature-coverage row against source and evidence before the first
implementation slice. Track missing work; do not overwrite another active plan.

## Acceptance and permission boundaries

Preserve React/Vite + Express/MySQL + Redis/BullMQ. Browser preview/local export
is client-side. Skia is the only server drawing engine; FFmpeg encodes/muxes.
Data-source fallback stays locked to riwayah/mushaf/numbering/range/fingerprints
and audited. It does not authorize AI model/provider fallback.

AI alignment remains draft/provisional until admin approval. Canonical Quran
text comes from trusted sources, never generated text or reference-image OCR.
Keep consent, ownership, server credentials, RTL/diacritics, keyboard support,
responsive behavior and reduced motion intact.

Every task needs targeted checks and traceable acceptance. Render work also needs
real playable output, picture/audio/timing inspection and worker logs. Mock,
build, health or preset names alone are insufficient. Distinguish implementation,
local verification, external integration and live acceptance in the ledger.

The owner explicitly authorized AyahX GitHub branches/commits/push/PR/CI/merge,
Railway changes and staging then production deployment after verification,
Cloudflare R2 configuration, and necessary database/Redis migrations with
backup, rehearsal and recovery checks. Verify current account/project/resource
identity before mutations; respect branch protection. Sol owns shared external
resources sequentially. Do not request routine authorization again.
Irrecoverable deletion, unrelated resources and substantial paid expansion are
outside this grant. Content-owner destination-specific consent remains required
for private media transmission; admin approval remains required for AI timing.
Continue independent work while any actual external prerequisite is unresolved.

## Sources and runtime baseline

Checked on 2026-10-15 with Codex CLI `0.162.0-alpha.17.2`:
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[config reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[model selection](https://developers.openai.com/api/docs/guides/model-selection).
Recheck native support/catalog after client changes. Explicit model settings in
the composer/CLI can override project defaults; existing chats keep their chosen
model/effort. Select Sol/medium for the coordinator when starting in the app.
