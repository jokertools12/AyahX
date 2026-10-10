// @vitest-environment node
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ENVIRONMENTS } from '../../scripts/lib/railwayQuranOps';
import { RailwayMysqlSession, openRailwayMysqlSession, redactSerialStderr, serialMysqlRemoteCommand, type SerialSessionOptions } from '../../scripts/lib/railwayMysqlSession';

class MockSsh extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly received: string[] = [];
  readonly frames: string[] = [];
  readonly stdin: Writable;
  exitCode: number | null = null;
  failSql: RegExp | null = null;
  closeCode = 0;
  closeHangs = false;
  threads = 1;
  maximum = 151;
  suppressAck = false;
  selectOutput = 'اختبار\t6\n';
  readonly kill = vi.fn(() => { queueMicrotask(() => this.finish(null, 'SIGTERM')); return true; });

  constructor(compression: 'gzip' | 'plain' = 'gzip') {
    super();
    this.stdin = new Writable({ write: (bytes, _encoding, callback) => {
      const frame = bytes.toString('utf8');
      this.frames.push(frame);
      const [mode, marker, encoded] = frame.trimEnd().split('\t');
      if (mode === 'C') {
        this.stdout.write(`AYAHX_SERIAL_CLOSED\t${marker}\t0\n`);
        callback();
        if (!this.closeHangs) queueMicrotask(() => this.finish(this.closeCode));
        return;
      }
      const sql = (mode === 'G' ? gunzipSync(Buffer.from(encoded, 'base64')) : Buffer.from(encoded, 'base64')).toString('utf8');
      this.received.push(sql);
      this.stdout.write(`AYAHX_SERIAL_BEGIN\t${marker}\n`);
      if (this.failSql?.test(sql)) {
        this.stderr.write('ERROR 1064 (42000): private SQL with password=secret https://example.org/?signature=secret\n');
        callback();
        queueMicrotask(() => this.finish(1));
        return;
      }
      if (sql.includes('Threads_connected')) this.stdout.write(`Threads_connected\t${this.threads}\nmax_connections\t${this.maximum}\n`);
      else if (/^SELECT/u.test(sql)) {
        const bytes = Buffer.from(this.selectOutput);
        // A multibyte Quran/Arabic character split across SSH chunks must survive.
        this.stdout.write(bytes.subarray(0, 1));
        this.stdout.write(bytes.subarray(1));
      }
      if (!this.suppressAck) this.stdout.write(`AYAHX_SERIAL_ACK\t${marker}\n`);
      callback();
    } });
    queueMicrotask(() => this.stdout.write(`AYAHX_SERIAL_READY\t1\t${compression}\n`));
  }
  asChild(): ChildProcessWithoutNullStreams { return this as unknown as ChildProcessWithoutNullStreams; }
  finish(code: number | null, signal: string | null = null): void {
    this.exitCode = code;
    this.emit('close', code, signal);
  }
}
async function sessionFor(mock = new MockSsh(), options: SerialSessionOptions = {}): Promise<{ mock: MockSsh; session: RailwayMysqlSession }> {
  const session = new RailwayMysqlSession(mock.asChild(), options);
  await session.waitReady();
  return { mock, session };
}

describe('single-session Railway mysql transport', () => {
  it('uses one SSH child for before reads, guarded writes, COMMIT and after reads', async () => {
    const mock = new MockSsh();
    const spawnChild = vi.fn(() => mock.asChild());
    const session = await openRailwayMysqlSession(ENVIRONMENTS.staging, { allowWrites: true, spawnChild });
    expect(await session.read('SELECT 1;')).toBe('اختبار\t6\n');
    const observations: number[] = [];
    const statement = "INSERT INTO reciters (id,name_ar) VALUES ('r','اسم');";
    await session.executeStatements([{ sql: statement, rowCount: 1 }], (row) => { observations.push(row.threads_connected); });
    await session.commit();
    await session.read('CHECKSUM TABLE reciters;');
    const evidence = await session.close();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(mock.received).toEqual(['SELECT 1;', "SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections';", statement,
      "SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections';", 'COMMIT;', 'CHECKSUM TABLE reciters;']);
    expect(mock.frames.filter((frame) => !frame.startsWith('C')) .every((frame) => frame.startsWith('G'))).toBe(true);
    expect(observations).toEqual([1]);
    expect(evidence).toMatchObject({ ssh_exit_code: 0, mysql_close_acknowledged: true, commit_acknowledged: true, acknowledged_commands: 6, compression: 'gzip' });
    expect(evidence.batches).toHaveLength(2);
    expect(session.commitAcknowledged).toBe(true);
    expect(session.threadChecks).toHaveLength(2);
    expect(await session.close()).toEqual(evidence);
  });
  it('uses uncompressed frames only when gunzip is unavailable', async () => {
    const { mock, session } = await sessionFor(new MockSsh('plain'));
    await session.read('SELECT 1;');
    expect(mock.frames[0]).toMatch(/^P\t/u);
    expect((await session.close()).compression).toBe('plain');
  });
  it('checks every batch and halts before any write at the connection limit', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true });
    mock.threads = mock.maximum;
    await expect(session.executeStatements([{ sql: 'INSERT INTO reciters VALUES (1);', rowCount: 1 }])).rejects.toMatchObject({ code: 'MYSQL_CONNECTION_LIMIT_REACHED' });
    expect(mock.received).toHaveLength(1);
    expect(mock.received[0]).toContain('SHOW GLOBAL STATUS');
    await expect(session.executeStatements([{ sql: 'COMMIT;', rowCount: 0 }])).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_WRITES_HALTED' });
    await session.read('SHOW PROCESSLIST;');
    expect((await session.close()).writes_halted).toBe(true);
  });
  it('stops subsequent writes when connection count rises between batches', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true });
    const rows = [{ sql: 'INSERT INTO reciters VALUES (1);', rowCount: 1 }, { sql: 'INSERT INTO reciters VALUES (2);', rowCount: 1 }];
    await expect(session.executeStatements(rows, () => { mock.threads = mock.maximum; })).rejects.toMatchObject({ code: 'MYSQL_CONNECTION_LIMIT_REACHED' });
    expect(mock.received.filter((sql) => sql.startsWith('INSERT'))).toEqual([rows[0].sql]);
    expect(session.evidence.batches.map((row) => row.threads_connected)).toEqual([1, 151]);
    await session.close();
  });
  it('validates all row limits and terminators before the first mutation', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true });
    await expect(session.executeStatements([{ sql: 'INSERT INTO reciters VALUES (1);', rowCount: 1 }, { sql: 'INSERT INTO reciters VALUES (2);', rowCount: 1001 }])).rejects.toMatchObject({ code: 'SQL_BATCH_LIMIT_EXCEEDED' });
    await expect(session.executeStatements([{ sql: 'COMMIT', rowCount: 0 }])).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_SQL_TERMINATOR_REQUIRED' });
    expect(mock.received).toHaveLength(0);
    await session.close();
  });
  it('requires explicit write authorization and blocks writes via the read helper', async () => {
    const { mock, session } = await sessionFor();
    await expect(session.executeStatements([{ sql: 'COMMIT;', rowCount: 0 }])).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_WRITES_NOT_AUTHORIZED' });
    await expect(session.read('SELECT 1; UPDATE users SET role=1;')).rejects.toMatchObject({ code: 'READ_ONLY_SQL_REQUIRED' });
    expect(mock.received).toHaveLength(0);
    await session.close();
  });
  it('retains real COMMIT acknowledgement but rejects a later SSH exit 1', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true });
    await session.commit();
    mock.closeCode = 1;
    await expect(session.close()).rejects.toMatchObject({ code: 'RAILWAY_SSH_EXIT_1', evidence: { commit_acknowledged: true, mysql_close_acknowledged: true, ssh_exit_code: 1 } });
  });
  it('requires native SSH completion even after mysql sends CLOSE acknowledgement', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true, commandTimeoutMs: 10 });
    await session.commit();
    mock.closeHangs = true;
    await expect(session.close()).rejects.toMatchObject({ code: 'RAILWAY_SSH_EXIT_TIMEOUT', evidence: { commit_acknowledged: true, mysql_close_acknowledged: true } });
    expect(mock.kill).toHaveBeenCalledTimes(1);
  });
  it('rejects a mysql error without inventing COMMIT acknowledgement or exposing SQL', async () => {
    const { mock, session } = await sessionFor(undefined, { allowWrites: true });
    mock.failSql = /^COMMIT/u;
    await expect(session.commit()).rejects.toMatchObject({ code: 'RAILWAY_SSH_EXIT_1', evidence: { commit_acknowledged: false, ssh_exit_code: 1 } });
    await expect(session.close()).rejects.toMatchObject({ code: 'RAILWAY_SSH_EXIT_1' });
    expect(session.evidence.stderr_redacted).toContain('MYSQL_ERROR_1064_42000');
    expect(JSON.stringify(session.evidence)).not.toMatch(/password|secret|https:/u);
  });
  it('records an SSH connection quota error before the handshake', async () => {
    const mock = new MockSsh();
    const session = new RailwayMysqlSession(mock.asChild());
    const waiting = session.waitReady();
    mock.stderr.write('Maximum SSH connections reached for this service. Close an existing session and try again.\n');
    mock.finish(1);
    await expect(waiting).rejects.toMatchObject({ code: 'RAILWAY_SSH_EXIT_1:SSH_CONNECTION_LIMIT', evidence: { ssh_exit_code: 1 } });
    expect(session.evidence.stderr_redacted).toContain('SSH_CONNECTION_LIMIT');
  });
  it('times out a missing ACK without treating the command as successful', async () => {
    const { mock, session } = await sessionFor(undefined, { commandTimeoutMs: 10 });
    mock.suppressAck = true;
    await expect(session.read('SELECT 1;')).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_COMMAND_TIMEOUT' });
    await expect(session.close()).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_COMMAND_TIMEOUT' });
    expect(mock.kill).toHaveBeenCalledTimes(1);
    expect(session.evidence.acknowledged_commands).toBe(0);
  });
  it('rejects mismatched framing and bounds output without disclosing it', async () => {
    const { mock, session } = await sessionFor(undefined, { maxOutputBytes: 256 });
    mock.selectOutput = 'x'.repeat(257) + '\n';
    await expect(session.read('SELECT 1;')).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_OUTPUT_LIMIT' });
    await expect(session.close()).rejects.toMatchObject({ code: 'RAILWAY_SERIAL_OUTPUT_LIMIT' });
    expect(mock.kill).toHaveBeenCalledTimes(1);
  });
  it('emits a remote shell script with no temp dump, one mysql process and explicit EOF', () => {
    const command = serialMysqlRemoteCommand();
    const payload = /printf %s '([A-Za-z0-9+/=]+)'/u.exec(command)?.[1];
    expect(payload).toBeTruthy();
    const script = Buffer.from(payload!, 'base64').toString('utf8');
    expect(script).toContain('coproc AYAHX_MYSQL');
    expect(script).toContain('--unbuffered --binary-mode');
    expect(script).toContain('exec {mysql_in_fd}>&-');
    expect(script).toContain('exec 3>&-');
    expect(script).toContain('wait "$mysql_pid"');
    expect(script).not.toMatch(/mktemp|mysql .*--force|\.sql|tee|chmod|rm /u);
  });
  it('redacts every unknown diagnostic while retaining fixed error identifiers', () => {
    const redacted = redactSerialStderr('AYAHX_SQL_NOT_ACKNOWLEDGED\nERROR 1050 (42S01): table users contains "private"\nMYSQL_ROOT_PASSWORD=private\nAYAHX_PRIVATE_TOKEN\nhttps://host/audio?token=private');
    expect(redacted).toBe('MYSQL_ERROR_1050_42S01\nAYAHX_SQL_NOT_ACKNOWLEDGED\n[diagnostic content redacted]');
    expect(redacted).not.toMatch(/private|token|users|PRIVATE_TOKEN/u);
  });

  const localBash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  it.skipIf(!existsSync(localBash))('exercises the real bash framing and EOF with a local mock mysql function', async () => {
    // The function is declared inside this shell; no database client, database,
    // remote service or network is used by this test.
    const fixture = String.raw`
mysql() {
  while IFS= read -r statement; do
    if [[ "$statement" = "SELECT '"*"';" ]]; then
      marker="$statement"
      marker="\${marker#SELECT \'}"
      marker="\${marker%\';}"
      printf '%s\n' "$marker"
    elif [[ "$statement" = "SHOW GLOBAL STATUS"* ]]; then
      printf 'Threads_connected\t1\nmax_connections\t151\n'
    elif [[ "$statement" = "SELECT 1;" ]]; then
      printf 'local_fixture\n'
    fi
  done
}
export -f mysql
export MYSQL_DATABASE=railway MYSQL_ROOT_PASSWORD=local_fixture
`;
    // String.raw retains the interpolation escape, so restore the two literal
    // bash parameter expansions without running JavaScript substitutions.
    const setup = fixture.replace(/\\\$/gu, '$');
    const child = spawn(localBash, ['-c', setup + '\n' + serialMysqlRemoteCommand()], { stdio: ['pipe', 'pipe', 'pipe'] });
    const session = new RailwayMysqlSession(child, { allowWrites: true, commandTimeoutMs: 5000 });
    await session.waitReady();
    expect(await session.read('SELECT 1;')).toBe('local_fixture\n');
    await session.executeStatements([{ sql: 'INSERT INTO reciters VALUES (1);', rowCount: 1 }]);
    await session.commit();
    expect(await session.close()).toMatchObject({ ssh_exit_code: 0, mysql_close_acknowledged: true, commit_acknowledged: true });
  });
});
