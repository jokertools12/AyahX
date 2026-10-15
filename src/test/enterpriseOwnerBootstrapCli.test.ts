import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { createCatalogGrantService } from '../../server/services/catalogGrantService';
import { bootstrapErrorMessage, main } from '../../scripts/enterprise-owner-bootstrap';

vi.mock('mysql2/promise', () => ({ createConnection: vi.fn() }));
vi.mock('../../server/services/catalogGrantService', () => ({ createCatalogGrantService: vi.fn() }));
let directory: string;
let input: string;
let output: string;
const bootstrap = vi.fn(); const end = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); directory = mkdtempSync(join(tmpdir(), 'ayahx-bootstrap-')); input = join(directory, 'input.json'); output = join(directory, 'report.json');
  writeFileSync(input, JSON.stringify({ target: { environment: 'production' }, expectedUserId: 'fixture-owner' }));
  vi.mocked(createConnection).mockResolvedValue({ end } as unknown as Awaited<ReturnType<typeof createConnection>>);
  vi.mocked(createCatalogGrantService).mockReturnValue({ bootstrapOwner: bootstrap } as unknown as ReturnType<typeof createCatalogGrantService>);
  bootstrap.mockResolvedValue({ grantId: 'fixture-grant', auditEventId: 'fixture-event', replayed: false });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const args = () => ['--input', input, '--out', output];
const environment = () => ({ ENTERPRISE_AUTHORITY_DATABASE_URL: 'mysql://fixture.invalid/fixture', ENTERPRISE_AUTHORITY_ENVIRONMENT: 'staging' });
describe('privileged owner bootstrap CLI boundaries', () => {
  it('derives environment independently of the untrusted target JSON', async () => {
    await main(args(), environment());
    expect(createCatalogGrantService).toHaveBeenCalledWith(expect.any(Function), Date.now, { environment: 'staging' });
    expect(bootstrap).toHaveBeenCalledWith(expect.objectContaining({ target: { environment: 'production' } }));
    expect(JSON.parse(readFileSync(output, 'utf8')).environment).toBe('staging'); expect(end).toHaveBeenCalledOnce();
  });
  it('requires explicit environment even if the input claims production', async () => {
    await expect(main(args(), { ENTERPRISE_AUTHORITY_DATABASE_URL: 'mysql://fixture.invalid/fixture' })).rejects.toThrow('EXPLICIT_BOOTSTRAP_ENVIRONMENT_REQUIRED');
    expect(createConnection).not.toHaveBeenCalled();
  });
  it('rejects a conflicting Railway environment before connecting', async () => {
    await expect(main(args(), { ...environment(), RAILWAY_ENVIRONMENT_NAME: 'production' })).rejects.toThrow('BOOTSTRAP_ENVIRONMENT_CONFLICT');
    expect(createConnection).not.toHaveBeenCalled();
  });
  it('requires an explicit server-only database credential', async () => {
    await expect(main(args(), { ENTERPRISE_AUTHORITY_ENVIRONMENT: 'staging' })).rejects.toThrow('ENTERPRISE_AUTHORITY_DATABASE_URL_REQUIRED');
    expect(createConnection).not.toHaveBeenCalled();
  });
  it('refuses an existing output before connecting or mutating', async () => {
    writeFileSync(output, 'preserved'); await expect(main(args(), environment())).rejects.toThrow();
    expect(createConnection).not.toHaveBeenCalled(); expect(readFileSync(output, 'utf8')).toBe('preserved');
  });
  it('leaves no success receipt and closes the connection when bootstrap fails', async () => {
    bootstrap.mockRejectedValueOnce(new Error('CATALOG_DATABASE_MISMATCH'));
    await expect(main(args(), environment())).rejects.toThrow('CATALOG_DATABASE_MISMATCH');
    expect(readFileSync(output, 'utf8')).toBe(''); expect(end).toHaveBeenCalledOnce();
  });
  it('does not expose database URLs, account identity or SQL in errors', () => {
    expect(bootstrapErrorMessage(new Error('mysql://private:secret@host/schema'))).toBe('ENTERPRISE_OWNER_BOOTSTRAP_FAILED');
    expect(bootstrapErrorMessage(new Error('CATALOG_DATABASE_MISMATCH'))).toBe('CATALOG_DATABASE_MISMATCH');
  });
});
