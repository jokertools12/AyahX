import {
  canFallbackSource,
  classifySourceFailure,
  resolutionRequestSchema,
  type ResolutionRequest,
  type SourceFailure,
  type StartedSourceAttempt,
  type TerminalSourceAttempt,
} from '../../shared/sourceResolution';
import type { SourceResolutionAttemptRepository } from '../db/sourceResolutionAttemptRepository';
import type { SourceResolutionCache } from './sourceResolutionCache';

export type SourceCandidateValidator<T> = (
  candidate: T,
  request: ResolutionRequest,
  source: ResolutionRequest['policy']['sources'][number],
) => SourceFailure | null | Promise<SourceFailure | null>;

export type SourceAdapter<T> = (
  request: ResolutionRequest,
  source: ResolutionRequest['policy']['sources'][number],
) => T | { candidate: T } | SourceFailure | { failure: unknown } | Promise<T | { candidate: T } | SourceFailure | { failure: unknown }>;

export type SourceAdapterMap<T> = ReadonlyMap<string, SourceAdapter<T>> | Readonly<Record<string, SourceAdapter<T>>>;

export type ResolutionAttempt = StartedSourceAttempt | TerminalSourceAttempt;
export type ResolutionOutcome<T> =
  | { status: 'selected' | 'review_required'; candidate: T; sourceId: string; sourceRevision: string; attempts: ResolutionAttempt[] }
  | { status: 'failed' | 'rejected'; failure: SourceFailure; attempts: ResolutionAttempt[] };

export interface SourceResolutionResolverOptions<T> {
  request: ResolutionRequest;
  adapters: SourceAdapterMap<T>;
  repository: SourceResolutionAttemptRepository;
  validateCandidate: SourceCandidateValidator<T>;
  cache?: SourceResolutionCache<T>;
  cacheTtlMs?: number;
  now?: () => number;
}

const adapterKeys = (sourceId: string, sourceRevision: string): string[] => [
  `${sourceId}@${sourceRevision}`, `${sourceId}:${sourceRevision}`, `${sourceId}/${sourceRevision}`, sourceId,
];

function findAdapter<T>(adapters: SourceAdapterMap<T>, sourceId: string, sourceRevision: string): SourceAdapter<T> | undefined {
  for (const key of adapterKeys(sourceId, sourceRevision)) {
    const adapter = adapters instanceof Map
      ? adapters.get(key)
      : (adapters as Readonly<Record<string, SourceAdapter<T>>>)[key];
    if (adapter) return adapter;
  }
  return undefined;
}

function adapterResult<T>(result: Awaited<ReturnType<SourceAdapter<T>>>): { candidate?: T; failure?: SourceFailure } {
  if (typeof result === 'string') {
    const failure = classifySourceFailure(result);
    return failure === 'unknown_error' ? { candidate: result as T } : { failure };
  }
  if (result && typeof result === 'object' && 'failure' in result) {
    return { failure: classifySourceFailure((result as { failure: unknown }).failure) };
  }
  if (result && typeof result === 'object' && 'candidate' in result) {
    return { candidate: (result as { candidate: T }).candidate };
  }
  return { candidate: result as T };
}

const terminalStatus = (failure: SourceFailure): 'failed' | 'rejected' =>
  canFallbackSource(failure) ? 'failed' : 'rejected';

export async function resolveSource<T>({ request: input, adapters, repository, validateCandidate, cache, cacheTtlMs, now = Date.now }: SourceResolutionResolverOptions<T>): Promise<ResolutionOutcome<T>> {
  const request = resolutionRequestSchema.parse(input);
  await repository.createRequestAnchor(request);
  const attempts: ResolutionAttempt[] = [];
  let lastFailure: SourceFailure = 'unknown_error';

  for (let ordinal = 0; ordinal < request.policy.sources.length; ordinal += 1) {
    const source = request.policy.sources[ordinal];
    const startedAtEpochMs = now();
    const started: StartedSourceAttempt = {
      serverRequestId: request.serverRequestId, payloadHash: request.payloadHash, lockHash: request.lockHash,
      policyHash: request.policyHash, policyRevision: request.policy.revision, ordinal,
      sourceId: source.sourceId, sourceRevision: source.sourceRevision, phase: 'started', startedAtEpochMs,
    };
    await repository.appendStarted(request, started);
    attempts.push(started);

    let failure: SourceFailure | null = null;
    let candidate: T | undefined;
    if (source.licenseDecision === 'blocked') failure = 'license_blocked';
    else if (source.consentDecision === 'blocked') failure = 'privacy_blocked';
    else {
      const cached = cache?.get(request, source);
      if (cached !== undefined) {
        candidate = cached;
        failure = await validateCandidate(candidate, request, source);
      } else {
        const adapter = findAdapter(adapters, source.sourceId, source.sourceRevision);
        if (!adapter) failure = 'not_indexed';
        else {
        try {
          const result = adapterResult(await adapter(request, source));
          if (result.failure) failure = result.failure;
          else {
            candidate = result.candidate;
            failure = await validateCandidate(candidate as T, request, source);
          }
        } catch {
          // Provider exceptions are terminal unknown_error; never infer timeout or continue silently.
          failure = 'unknown_error';
          candidate = undefined;
        }
        }
      }
    }

    const endedAtEpochMs = now();
    const durationMs = Math.max(0, endedAtEpochMs - startedAtEpochMs);
    const status: TerminalSourceAttempt['status'] = failure
      ? terminalStatus(failure)
      : request.purpose === 'review' ? 'review_required' : 'selected';
    const terminal: TerminalSourceAttempt = {
      ...started, phase: 'terminal', endedAtEpochMs, durationMs, status,
      failureClass: failure, reasonCode: failure ?? (status === 'selected' ? 'candidate_validated' : 'provisional_review'),
    };
    attempts.push(terminal);
    const shouldContinue = failure !== null && canFallbackSource(failure) && ordinal + 1 < request.policy.sources.length;
    if (!shouldContinue) {
      await repository.appendTerminal(request, started, terminal);
      if (!failure && candidate !== undefined) {
        cache?.set(request, source, candidate, cacheTtlMs ?? 60_000);
      }
      if (failure) return { status: terminalStatus(failure), failure, attempts };
      return {
        status: request.purpose === 'review' ? 'review_required' : 'selected',
        candidate: candidate as T,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        attempts,
      };
    }
    await repository.appendTerminalThen(request, started, terminal, async () => undefined);
    lastFailure = failure;
  }
  return { status: 'failed', failure: lastFailure, attempts };
}

export const resolveSourceRequest = resolveSource;


