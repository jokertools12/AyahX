# Source resolution and attempt persistence — Tasks 1.3 / 2.4

Status: design for review; no adapter, route, migration or source activation.
References: package IMPLEMENTATION_TASKS Tasks 1.3/2.4 and
05_CONTRACTS/quran-data-mesh.contract.ts; current shared/recordingAvailability.ts
takes precedence over the package's free-form range strings.

## Responsibility and order

1. Define strict runtime schemas for a server-created resolution lock, approved
   ordered source policy and sanitized attempt records, with deterministic fixtures.
2. Implement an injected resolver and durable ledger boundary; no network adapter
   or runtime wiring until source/content authority and persistence are verified.
3. Add separately reviewed additive storage and operator migration, then grant only
   the required new privileges explicitly. Do not change the current 31-table runtime
   contract or existing principals implicitly. Rehearse and verify before activation.
4. Add approved adapters/cache individually, and only then wire consumer routes and
   final-export revalidation. These later steps are not acceptance of this contract.

## Identity and authority

The lock extends the existing reader scope: reciter, exact recording, riwayah,
mushaf profile and numbering system, plus surah/from/to ayah, text revision and
SHA-256, audio asset and SHA-256, and the explicitly requested timing level
(`requiredTiming`: ayah, word or letter). Integers and ranges use existing availability
bounds. It is created from trusted current catalog/content state, never accepted
as authority from the request body. The exact canonical lock hash is fixed for
the whole resolution. No normalization of Quran text or audio before hashing.

Each source policy entry pins source ID and revision, its eligible identity and
license/consent decision. Source order and policy revision are server-owned and
bounded; duplicate entries are invalid. Private media leaves the server only
with valid destination-specific consent. Source fallback does not imply any AI
provider/model fallback. A source may not change the lock or its own policy.

## Attempt durability and outcomes

Create a durable request anchor containing the actor/ownership scope, lock hash,
purpose, exact requiredTiming, ordered policy hash and server request ID before
any external work. The idempotency payload hash includes requiredTiming; changing
it under the same request ID is a conflict, even if the recording is unchanged.
Persist a started record before invoking each adapter and its terminal record
before continuing or returning a result. Records are append-only. The storage
design must enforce unique request/ordinal/phase, pairing and exact idempotency;
same ID with changed payload is a conflict. No returned receipt or in-memory
callback alone counts as durable persistence.

Every visited source has an ordinal, pinned source/revision, start/end timestamps,
bounded nonnegative duration, status and sanitized failure/reason enum. Never
store provider exception text, URLs/query strings, tokens, private media, Quran
text or account email in attempt diagnostics. Store ownership as a protected
reference and authorize ledger reads. Retention is an explicit later policy;
do not add automatic deletion or claim 48-hour expiry from this contract.

A crash can leave a started record without a terminal record. This is an
incomplete attempt, never a selected source or an inferred timeout. Retrying
must not duplicate an in-flight adapter invocation; recovery/lease rules must
be reviewed before runtime activation. Failure to persist either phase stops
resolution. No further source call or successful response may follow it.

Only timeout, rate_limited, not_indexed and capacity permit moving to the next
source within the pinned policy. Unknown exceptions are terminal unknown_error.
Identity, fingerprint, malformed payload, licensing, consent and approval
failures stop; record the rejection before returning. An observed timeout must
abort the adapter work; a detached promise cannot authorize continuing fallback.

A selected candidate must pass runtime shape, byte-checksum, exact lock,
provenance and timing validation and current trusted approval. Validation evidence
must explicitly certify requiredTiming; never infer word timing from letter timing
or a finer level from ayah timing. Metadata matching
alone is insufficient. Final export requires approved timing and a fresh
availability/authority check before accepting its output. Review-only provisional
results return review_required, never ready/selected for final export.

## Acceptance and commands

Fixtures must cover ordered transient fallback, every identity mismatch stopping
subsequent calls, source/revision spoofing, malformed and unknown failures,
approval/consent/license denial, approved ayah-only versus word-required requests,
changed requiredTiming under the same request ID, immutable input, persistence failure at each
phase, exact retry versus payload conflict, crash/in-flight handling, ownership,
and absence of raw provider data in persisted diagnostics. Tests use injected
adapters and storage; they make no model or network calls.

Run targeted Vitest suites, app TypeScript, strict compilation and ESLint for
new server helpers; run npm run build at integration. Real MySQL tests must
establish durable request/attempt semantics, rollback and concurrency separately.
CI adds the accepted suites. Do not label Tasks 1.3/2.4 complete until durable
storage and actual runtime consumers are independently verified.

Design review: Astra identified missing requiredTiming in the initial anchor;
the schema, payload-hash and exact-level evidence requirements above correct it.
No database or runtime acceptance is claimed by this design review.
