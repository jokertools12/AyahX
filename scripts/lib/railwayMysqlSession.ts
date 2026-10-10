import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { railwayBinary, railwayEnv, sshArgs } from './railwayQuranOps';

export interface SerialSqlStatement { sql: string; rowCount: number }
export interface SerialBatchEvidence {
  ordinal: number; row_count: number; sql_sha256: string;
  threads_connected: number; max_connections: number;
  sql_bytes?: number; wire_request_bytes?: number; elapsed_ms?: number;
}
export interface SerialSessionEvidence {
  ssh_exit_code: number | null; ssh_signal: string | null;
  stderr_redacted: string; compression: 'plain' | 'gzip' | null;
  mysql_close_acknowledged: boolean; commit_acknowledged: boolean;
  acknowledged_commands: number; writes_halted: boolean;
  batches: SerialBatchEvidence[];
  transport_request_bytes: number; transport_response_bytes: number;
}
export class SerialMysqlError extends Error {
  constructor(public readonly code: string, public readonly evidence: SerialSessionEvidence) {
    super(code);
    this.name = 'SerialMysqlError';
  }
}
export type SerialChildFactory = (binary: string, args: string[], options: {
  env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'];
}) => ChildProcessWithoutNullStreams;
export interface SerialSessionOptions {
  allowWrites?: boolean;
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  spawnChild?: SerialChildFactory;
}
interface PendingCommand {
  marker: string; kind: 'read' | 'write' | 'commit' | 'close' | 'storage'; begun: boolean;
  lines: string[]; bytes: number; timer: ReturnType<typeof setTimeout>;
  resolve: (result: string) => void; reject: (error: SerialMysqlError) => void;
}

// Diagnostic content is never copied to reports. Unknown lines may contain SQL
// values, credentials or signed URLs, so only fixed error identifiers survive.
export function redactSerialStderr(stderr: string): string {
  const identifiers = new Set<string>();
  if (stderr.includes('Maximum SSH connections reached for this service')) identifiers.add('SSH_CONNECTION_LIMIT');
  for (const match of stderr.matchAll(/ERROR (\d{3,5}) \(([A-Z0-9]{5})\)/gu)) identifiers.add(`MYSQL_ERROR_${match[1]}_${match[2]}`);
  for (const code of ['DATABASE_NOT_APPROVED', 'BASE64_MISSING', 'FRAME_MARKER_INVALID', 'MYSQL_CLOSE_FAILED',
    'FRAME_MODE_INVALID', 'FRAME_PAYLOAD_INVALID', 'FRAME_DECODE_FAILED', 'SQL_NOT_ACKNOWLEDGED', 'CLOSE_FRAME_REQUIRED']) {
    const identifier = `AYAHX_${code}`;
    if (new RegExp(`\\b${identifier}\\b`, 'u').test(stderr)) identifiers.add(identifier);
  }
  if (stderr.trim()) identifiers.add('[diagnostic content redacted]');
  return [...identifiers].join('\n');
}

export function serialMysqlRemoteCommand(): string {
  const script = readFileSync(fileURLToPath(new URL('./railwaySerialMysql.remote.sh', import.meta.url)), 'utf8').replace(/\r\n/gu, '\n');
  return `bash -c "$(printf %s '${Buffer.from(script).toString('base64')}' | base64 -d)"`;
}

export class RailwayMysqlSession {
  private readonly nonce = randomBytes(16).toString('hex');
  private readonly decoder = new StringDecoder('utf8');
  private sequence = 0;
  private outputBuffer = '';
  private diagnostic = '';
  private pending: PendingCommand | null = null;
  private failure: string | null = null;
  private ready = false;
  private closing = false;
  private ended = false;
  private terminationRequested = false;
  private exitCode: number | null = null;
  private exitSignal: string | null = null;
  private compression: 'plain' | 'gzip' | null = null;
  private closeAcknowledged = false;
  private commitWasAcknowledged = false;
  private acknowledged = 0;
  private writesHalted = false;
  private batches: SerialBatchEvidence[] = [];
  private requestBytes = 0;
  private responseBytes = 0;
  private lastRequestBytes = 0;
  private readonly readyPromise: Promise<void>;
  private readonly exitPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: SerialMysqlError) => void;
  private resolveExit!: () => void;
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  private readonly timeoutMs: number;
  private readonly outputLimit: number;

  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly options: SerialSessionOptions = {}) {
    this.timeoutMs = options.commandTimeoutMs ?? 120_000;
    this.outputLimit = options.maxOutputBytes ?? 128 * 1024 * 1024;
    this.readyPromise = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.exitPromise = new Promise<void>((resolve) => { this.resolveExit = resolve; });
    this.readyTimer = setTimeout(() => this.fail('RAILWAY_SERIAL_READY_TIMEOUT', true), this.timeoutMs);
    child.stdout.on('data', (bytes: Buffer) => { this.responseBytes += bytes.length; this.onOutput(this.decoder.write(bytes)); });
    child.stderr.on('data', (bytes: Buffer) => { this.diagnostic = (this.diagnostic + bytes.toString('utf8')).slice(0, 8192); });
    child.stdin.on('error', () => this.fail('RAILWAY_SERIAL_STDIN_FAILED', true));
    child.once('error', () => { this.fail('RAILWAY_SSH_START_FAILED', true); this.ended = true; this.resolveExit(); });
    child.once('close', (code, signal) => {
      this.ended = true;
      this.exitCode = code;
      this.exitSignal = signal;
      clearTimeout(this.readyTimer);
      const reason = this.diagnostic.includes('Maximum SSH connections reached for this service') ? ':SSH_CONNECTION_LIMIT' : '';
      if (code !== 0) this.fail(`RAILWAY_SSH_EXIT_${code}${reason}`);
      else if (!this.closeAcknowledged) this.fail('RAILWAY_SERIAL_CLOSE_NOT_ACKNOWLEDGED');
      this.resolveExit();
    });
  }

  get evidence(): SerialSessionEvidence {
    return {
      ssh_exit_code: this.exitCode, ssh_signal: this.exitSignal,
      stderr_redacted: redactSerialStderr(this.diagnostic), compression: this.compression,
      mysql_close_acknowledged: this.closeAcknowledged, commit_acknowledged: this.commitWasAcknowledged,
      acknowledged_commands: this.acknowledged, writes_halted: this.writesHalted,
      batches: this.batches.map((row) => ({ ...row })),
      transport_request_bytes: this.requestBytes, transport_response_bytes: this.responseBytes,
    };
  }

  async waitReady(): Promise<void> { await this.readyPromise; }
  get commitAcknowledged(): boolean { return this.commitWasAcknowledged; }
  get threadChecks(): SerialBatchEvidence[] { return this.batches.map((row) => ({ ...row })); }

  private fail(code: string, terminate = false): void {
    this.failure ??= code;
    const error = new SerialMysqlError(this.failure, this.evidence);
    clearTimeout(this.readyTimer);
    if (!this.ready) this.rejectReady(error);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    if (terminate && !this.ended && !this.terminationRequested) { this.terminationRequested = true; this.child.kill(); }
  }

  private onOutput(text: string): void {
    if (this.failure) return;
    this.outputBuffer += text;
    if (Buffer.byteLength(this.outputBuffer) > this.outputLimit) { this.fail('RAILWAY_SERIAL_OUTPUT_LIMIT', true); return; }
    let boundary: number;
    while ((boundary = this.outputBuffer.indexOf('\n')) !== -1) {
      const line = this.outputBuffer.slice(0, boundary).replace(/\r$/u, '');
      this.outputBuffer = this.outputBuffer.slice(boundary + 1);
      if (!this.ready) {
        const match = /^AYAHX_SERIAL_READY\t1\t(plain|gzip)$/u.exec(line);
        if (!match) { this.fail('RAILWAY_SERIAL_HANDSHAKE_INVALID', true); return; }
        this.ready = true;
        this.compression = match[1] as 'plain' | 'gzip';
        clearTimeout(this.readyTimer);
        this.resolveReady();
        continue;
      }
      const current = this.pending;
      if (!current) { this.fail('RAILWAY_SERIAL_UNEXPECTED_OUTPUT', true); return; }
      if (current.kind === 'close') {
        if (line !== `AYAHX_SERIAL_CLOSED\t${current.marker}\t0`) { this.fail('RAILWAY_SERIAL_CLOSE_INVALID', true); return; }
        this.closeAcknowledged = true;
        clearTimeout(current.timer);
        this.pending = null;
        current.resolve('');
      } else if (!current.begun) {
        if (line !== `AYAHX_SERIAL_BEGIN\t${current.marker}`) { this.fail('RAILWAY_SERIAL_BEGIN_INVALID', true); return; }
        current.begun = true;
      } else if (line === `AYAHX_SERIAL_ACK\t${current.marker}`) {
        this.acknowledged += 1;
        if (current.kind === 'commit') this.commitWasAcknowledged = true;
        clearTimeout(current.timer);
        this.pending = null;
        current.resolve(current.lines.length ? current.lines.join('\n') + '\n' : '');
      } else {
        current.bytes += Buffer.byteLength(line) + 1;
        if (current.bytes > this.outputLimit) { this.fail('RAILWAY_SERIAL_OUTPUT_LIMIT', true); return; }
        current.lines.push(line);
      }
    }
  }

  private async command(sql: string, kind: PendingCommand['kind']): Promise<string> {
    await this.waitReady();
    if (this.failure) throw new SerialMysqlError(this.failure, this.evidence);
    if (this.ended || (this.closing && kind !== 'close')) throw new SerialMysqlError('RAILWAY_SERIAL_SESSION_CLOSED', this.evidence);
    if (this.pending) throw new SerialMysqlError('RAILWAY_SERIAL_CONCURRENT_COMMAND_PROHIBITED', this.evidence);
    if (kind !== 'close' && kind !== 'storage' && !sql.trimEnd().endsWith(';')) throw new SerialMysqlError('RAILWAY_SERIAL_SQL_TERMINATOR_REQUIRED', this.evidence);
    const marker = `${this.nonce}_${++this.sequence}`;
    const payload = kind === 'close' || kind === 'storage' ? '-' : (this.compression === 'gzip' ? gzipSync(Buffer.from(sql)) : Buffer.from(sql)).toString('base64');
    const mode = kind === 'close' ? 'C' : kind === 'storage' ? 'D' : this.compression === 'gzip' ? 'G' : 'P';
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.fail('RAILWAY_SERIAL_COMMAND_TIMEOUT', true), this.timeoutMs);
      this.pending = { marker, kind, begun: false, lines: [], bytes: 0, timer, resolve, reject };
      const frame = `${mode}\t${marker}\t${payload}\n`;
      this.lastRequestBytes = Buffer.byteLength(frame);
      this.requestBytes += this.lastRequestBytes;
      this.child.stdin.write(frame, (error) => { if (error) this.fail('RAILWAY_SERIAL_STDIN_FAILED', true); });
    });
  }

  async read(sql: string): Promise<string> {
    if (!/^\s*(SELECT|SHOW|CHECKSUM)\b/iu.test(sql) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|RENAME|TRUNCATE|INTO\s+OUTFILE)\b/iu.test(sql)) {
      throw new SerialMysqlError('READ_ONLY_SQL_REQUIRED', this.evidence);
    }
    return this.command(sql, 'read');
  }

  /** Actual MySQL filesystem observation inside this same SSH session. No additional connection. */
  async storage(): Promise<{ total_bytes: number; used_bytes: number; available_bytes: number }> {
    const value = JSON.parse((await this.command('', 'storage')).trim()) as { total_bytes: number; used_bytes: number; available_bytes: number };
    if (![value.total_bytes, value.used_bytes, value.available_bytes].every((n) => Number.isSafeInteger(n) && n >= 0) || value.total_bytes <= 0 || value.available_bytes > value.total_bytes) throw new SerialMysqlError('MYSQL_STORAGE_MEASUREMENT_INVALID', this.evidence);
    return value;
  }

  async executeStatements(statements: readonly SerialSqlStatement[], beforeBatch?: (row: SerialBatchEvidence) => void | Promise<void>): Promise<void> {
    if (!this.options.allowWrites) throw new SerialMysqlError('RAILWAY_SERIAL_WRITES_NOT_AUTHORIZED', this.evidence);
    if (this.writesHalted) throw new SerialMysqlError('RAILWAY_SERIAL_WRITES_HALTED', this.evidence);
    // Validate the entire supplied plan before its first write.
    for (const row of statements) {
      if (!Number.isInteger(row.rowCount) || row.rowCount < 0 || row.rowCount > 1000) throw new SerialMysqlError('SQL_BATCH_LIMIT_EXCEEDED', this.evidence);
      if (!row.sql.trimEnd().endsWith(';')) throw new SerialMysqlError('RAILWAY_SERIAL_SQL_TERMINATOR_REQUIRED', this.evidence);
    }
    for (const row of statements) {
      const raw = await this.read("SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections';");
      const fields = Object.fromEntries(raw.trim().split(/\r?\n/u).map((line) => line.split('\t')));
      const threads = Number(fields.Threads_connected), maximum = Number(fields.max_connections);
      if (!Number.isInteger(threads) || threads < 1 || !Number.isInteger(maximum) || maximum < 1) {
        this.writesHalted = true;
        throw new SerialMysqlError('MYSQL_CONNECTION_STATUS_INVALID', this.evidence);
      }
      const observation: SerialBatchEvidence = { ordinal: this.batches.length + 1, row_count: row.rowCount,
        sql_sha256: createHash('sha256').update(row.sql).digest('hex'), threads_connected: threads, max_connections: maximum };
      this.batches.push(observation);
      if (threads >= maximum) {
        this.writesHalted = true;
        throw new SerialMysqlError('MYSQL_CONNECTION_LIMIT_REACHED', this.evidence);
      }
      await beforeBatch?.({ ...observation });
      const isCommit = /^\s*COMMIT\s*;\s*$/iu.test(row.sql);
      const started = Date.now();
      await this.command(row.sql, isCommit ? 'commit' : 'write');
      observation.elapsed_ms = Date.now() - started;
      observation.sql_bytes = Buffer.byteLength(row.sql);
      observation.wire_request_bytes = this.lastRequestBytes;
    }
  }

  async commit(): Promise<void> { await this.executeStatements([{ sql: 'COMMIT;', rowCount: 0 }]); }

  async close(): Promise<SerialSessionEvidence> {
    if (this.pending) throw new SerialMysqlError('RAILWAY_SERIAL_CONCURRENT_CLOSE_PROHIBITED', this.evidence);
    if (!this.ended && !this.failure && !this.closing) {
      this.closing = true;
      await this.command('', 'close');
      this.child.stdin.end();
    } else if (!this.ended && this.failure) {
      this.child.stdin.end();
    }
    // A COMMIT/CLOSE acknowledgement does not prove that the SSH transport
    // finished. Bound this separate wait and require the native exit code.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('RAILWAY_SSH_EXIT_TIMEOUT', true);
        reject(new SerialMysqlError(this.failure ?? 'RAILWAY_SSH_EXIT_TIMEOUT', this.evidence));
      }, this.timeoutMs);
      this.exitPromise.then(() => { clearTimeout(timer); resolve(); });
    });
    if (this.failure) throw new SerialMysqlError(this.failure, this.evidence);
    if (this.exitCode !== 0 || !this.closeAcknowledged) throw new SerialMysqlError('RAILWAY_SERIAL_CLOSE_NOT_ACKNOWLEDGED', this.evidence);
    return this.evidence;
  }
}

export async function openRailwayMysqlSession(environment: string, options: SerialSessionOptions = {}): Promise<RailwayMysqlSession> {
  const args = sshArgs(environment, serialMysqlRemoteCommand());
  const child = (options.spawnChild ?? ((binary, argv, settings) => spawn(binary, argv, settings)))(railwayBinary, args, { env: railwayEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const session = new RailwayMysqlSession(child, options);
  await session.waitReady();
  return session;
}
