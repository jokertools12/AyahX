import { resolutionRequestSchema, startedSourceAttemptSchema, terminalSourceAttemptSchema, validateSourceAttemptPair,
  type ResolutionRequest, type StartedSourceAttempt, type TerminalSourceAttempt } from '../../shared/sourceResolution';

/** Narrow injected SQL boundary. This module does not create a pool or activate a schema. */
export type SourceResolutionQuery = (sql: string, parameters: readonly unknown[]) => Promise<unknown[]>;

export const sourceResolutionRequestInsertSql = `INSERT INTO source_resolution_requests
 (server_request_id, actor_reference, ownership_reference, purpose, required_timing, lock_hash, policy_hash, payload_hash, policy_revision, policy_json)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const sourceResolutionRequestByIdSql = `SELECT server_request_id AS serverRequestId, payload_hash AS payloadHash
 FROM source_resolution_requests WHERE server_request_id = ? LIMIT 1`;
export const sourceResolutionAttemptInsertSql = `INSERT INTO source_resolution_attempts
 (server_request_id, payload_hash, lock_hash, policy_hash, policy_revision, ordinal, source_id, source_revision,
  phase, started_at_epoch_ms, ended_at_epoch_ms, duration_ms, status, failure_class, reason_code)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const sourceResolutionAttemptsReadSql = `SELECT server_request_id AS serverRequestId, payload_hash AS payloadHash,
 lock_hash AS lockHash, policy_hash AS policyHash, policy_revision AS policyRevision, ordinal, source_id AS sourceId,
 source_revision AS sourceRevision, phase, started_at_epoch_ms AS startedAtEpochMs, ended_at_epoch_ms AS endedAtEpochMs,
 duration_ms AS durationMs, status, failure_class AS failureClass, reason_code AS reasonCode
 FROM source_resolution_attempts a JOIN source_resolution_requests r ON r.server_request_id = a.server_request_id
 WHERE a.server_request_id = ? AND r.ownership_reference = ? ORDER BY ordinal ASC, phase ASC`;

export class SourceResolutionIdempotencyConflictError extends Error {
  readonly code = 'source_resolution_idempotency_conflict';
  constructor(serverRequestId: string) {
    super(`Source resolution request already exists with a different payload: ${serverRequestId}`);
    this.name = 'SourceResolutionIdempotencyConflictError';
  }
}

export class SourceResolutionPersistenceError extends Error {
  readonly code = 'source_resolution_persistence_failed';
  constructor(message = 'Source resolution persistence failed') { super(message); this.name = 'SourceResolutionPersistenceError'; }
}

type RequestRow = { serverRequestId?: unknown; payloadHash?: unknown };
const safeRequestRow = (row: unknown): { serverRequestId: string; payloadHash: string } | null => {
  if (!row || typeof row !== 'object') return null;
  const value = row as RequestRow;
  return typeof value.serverRequestId === 'string' && typeof value.payloadHash === 'string'
    ? { serverRequestId: value.serverRequestId, payloadHash: value.payloadHash } : null;
};

const anchorParameters = (request: ResolutionRequest): readonly unknown[] => [
  request.serverRequestId, request.actorReference, request.ownershipReference, request.purpose,
  request.requiredTiming, request.lockHash, request.policyHash, request.payloadHash, request.policy.revision,
  JSON.stringify(request.policy),
];

const attemptParameters = (attempt: StartedSourceAttempt | TerminalSourceAttempt): readonly unknown[] => [
  attempt.serverRequestId, attempt.payloadHash, attempt.lockHash, attempt.policyHash, attempt.policyRevision,
  attempt.ordinal, attempt.sourceId, attempt.sourceRevision, attempt.phase, attempt.startedAtEpochMs,
  attempt.phase === 'terminal' ? attempt.endedAtEpochMs : null,
  attempt.phase === 'terminal' ? attempt.durationMs : null,
  attempt.phase === 'terminal' ? attempt.status : null,
  attempt.phase === 'terminal' ? attempt.failureClass : null,
  attempt.phase === 'terminal' ? attempt.reasonCode : null,
];

function assertRequest(request: unknown): ResolutionRequest {
  return resolutionRequestSchema.parse(request);
}
function assertStarted(request: ResolutionRequest, attempt: unknown): StartedSourceAttempt {
  const parsed = startedSourceAttemptSchema.parse(attempt);
  const source = request.policy.sources[parsed.ordinal];
  const matches = source && source.sourceId === parsed.sourceId && source.sourceRevision === parsed.sourceRevision
    && parsed.serverRequestId === request.serverRequestId && parsed.payloadHash === request.payloadHash
    && parsed.lockHash === request.lockHash && parsed.policyHash === request.policyHash
    && parsed.policyRevision === request.policy.revision;
  if (!matches) throw new SourceResolutionPersistenceError('Started attempt does not match request identity');
  return parsed;
}
function assertTerminal(request: ResolutionRequest, started: StartedSourceAttempt, terminal: unknown): TerminalSourceAttempt {
  const parsed = terminalSourceAttemptSchema.parse(terminal);
  if (!validateSourceAttemptPair(request, started, parsed)) throw new SourceResolutionPersistenceError('Terminal attempt does not match request identity');
  return parsed;
}

export interface SourceResolutionAttemptRepository {
  createRequestAnchor(request: ResolutionRequest): Promise<'created' | 'existing'>;
  appendStarted(request: ResolutionRequest, attempt: StartedSourceAttempt): Promise<void>;
  appendTerminal(request: ResolutionRequest, started: StartedSourceAttempt, terminal: TerminalSourceAttempt): Promise<void>;
  appendTerminalThen<T>(request: ResolutionRequest, started: StartedSourceAttempt, terminal: TerminalSourceAttempt,
    next: () => Promise<T>): Promise<T>;
  readAttempts(serverRequestId: string, ownershipReference: string): Promise<Array<StartedSourceAttempt | TerminalSourceAttempt>>;
}

export function createSourceResolutionAttemptRepository(query: SourceResolutionQuery): SourceResolutionAttemptRepository {
  return {
    async createRequestAnchor(input) {
      const request = assertRequest(input);
      const rows = await query(sourceResolutionRequestByIdSql, [request.serverRequestId]);
      if (rows.length > 1) throw new SourceResolutionPersistenceError('Duplicate source resolution request anchors');
      if (rows.length === 1) {
        const existing = safeRequestRow(rows[0]);
        if (!existing) throw new SourceResolutionPersistenceError('Malformed source resolution request anchor');
        if (existing.payloadHash !== request.payloadHash) throw new SourceResolutionIdempotencyConflictError(request.serverRequestId);
        return 'existing';
      }
      await query(sourceResolutionRequestInsertSql, anchorParameters(request));
      return 'created';
    },
    async appendStarted(input, attempt) {
      const request = assertRequest(input);
      const started = assertStarted(request, attempt);
      await query(sourceResolutionAttemptInsertSql, attemptParameters(started));
    },
    async appendTerminal(input, startedInput, terminalInput) {
      const request = assertRequest(input);
      const started = assertStarted(request, startedInput);
      const terminal = assertTerminal(request, started, terminalInput);
      await query(sourceResolutionAttemptInsertSql, attemptParameters(terminal));
    },
    async appendTerminalThen(request, started, terminal, next) {
      await this.appendTerminal(request, started, terminal);
      return next();
    },
    async readAttempts(serverRequestId, ownershipReference) {
      const rows = await query(sourceResolutionAttemptsReadSql, [serverRequestId, ownershipReference]);
      const result: Array<StartedSourceAttempt | TerminalSourceAttempt> = [];
      for (const row of rows) {
        const parsed = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
        if (!parsed || parsed.phase === 'started') {
          const startedResult = startedSourceAttemptSchema.safeParse(parsed);
          if (startedResult.success) result.push(startedResult.data);
          continue;
        }
        const terminal = terminalSourceAttemptSchema.safeParse(parsed);
        if (terminal.success) result.push(terminal.data);
      }
      return result;
    },
  };
}
