// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sourceResolutionLedgerMigrationDefinition as definition, sourceResolutionLedgerMigrationSql } from '../../server/db/migrations/sourceResolutionLedger';

describe('003 source resolution ledger definition', () => {
  it('uses exact ordered additive steps and current 31-table baseline', () => {
    expect(definition.id).toBe('003-source-resolution-ledger');
    expect(definition.tables).toEqual(['source_resolution_requests', 'source_resolution_attempts']);
    expect(definition.triggers).toHaveLength(4);
    expect(definition.steps.map(step => step.name)).toEqual([...definition.tables, ...definition.triggers]);
    expect(definition.steps.slice(0, 2).every(step => step.kind === 'table')).toBe(true);
    expect(definition.steps.slice(2).every(step => step.kind === 'trigger')).toBe(true);
    expect(definition.requiredTables).toHaveLength(31);
  });

  it('defines repository-compatible columns, checks, uniqueness and immutable triggers', () => {
    for (const column of ['server_request_id', 'actor_reference', 'ownership_reference', 'purpose', 'required_timing', 'lock_hash', 'policy_hash', 'payload_hash', 'policy_revision', 'policy_json']) expect(sourceResolutionLedgerMigrationSql).toContain('`' + column + '`');
    for (const column of ['server_request_id', 'payload_hash', 'lock_hash', 'policy_hash', 'policy_revision', 'ordinal', 'source_id', 'source_revision', 'phase', 'started_at_epoch_ms', 'ended_at_epoch_ms', 'duration_ms', 'status', 'failure_class', 'reason_code']) expect(sourceResolutionLedgerMigrationSql).toContain('`' + column + '`');
    expect(sourceResolutionLedgerMigrationSql).toContain("REGEXP '^[0-9a-f]{64}$'");
    expect(sourceResolutionLedgerMigrationSql).toContain('UNIQUE KEY `uq_source_attempt_request_ordinal_phase`');
    expect(sourceResolutionLedgerMigrationSql).toContain('UNIQUE KEY `uq_source_attempt_request_selected`');
    expect(sourceResolutionLedgerMigrationSql).toContain("`duration_ms` IS NULL OR `duration_ms` >= 0");
    expect(sourceResolutionLedgerMigrationSql).toContain('`phase` = \'started\'');
    expect(sourceResolutionLedgerMigrationSql).toContain('source_resolution_requests_no_update');
    expect(sourceResolutionLedgerMigrationSql).toContain('source_resolution_requests_no_delete');
    expect(sourceResolutionLedgerMigrationSql).toContain('source_resolution_attempts_no_update');
    expect(sourceResolutionLedgerMigrationSql).toContain('source_resolution_attempts_no_delete');
    expect(sourceResolutionLedgerMigrationSql).not.toMatch(/CREATE TABLE IF NOT EXISTS/);
  });
});
