import assert from 'node:assert/strict';
import type {SerialSessionEvidence,RailwayMysqlSession} from './railwayMysqlSession';
import {assertFreshQaBackup,type QaBackupProof} from './temporaryAdminQaBackup';

/** The caller finishes its read-only preflight before entering this write boundary. */
export async function executeAdminWorkspaceMigration(session:Pick<RailwayMysqlSession,'executeStatements'|'commit'>,sql:readonly string[],backup:QaBackupProof,now:()=>number=Date.now):Promise<void>{
 assertFreshQaBackup(backup,now());
 await session.executeStatements(sql.map(statement=>({sql:statement+';',rowCount:0})));await session.commit();
}

export function assertAdminWorkspaceSerialProof(value:unknown,applied:boolean):asserts value is SerialSessionEvidence {
 assert.ok(value&&typeof value==='object','ADMIN_WORKSPACE_SERIAL_PROOF_REQUIRED');
 const proof=value as Partial<SerialSessionEvidence>;
 assert.ok(proof.ssh_exit_code===0&&proof.ssh_signal===null&&proof.mysql_close_acknowledged===true&&proof.writes_halted===false,'ADMIN_WORKSPACE_TRANSPORT_NOT_VERIFIED');
 assert.ok(['plain','gzip'].includes(String(proof.compression))&&Number.isSafeInteger(proof.acknowledged_commands)&&Number(proof.acknowledged_commands)>0&&Number.isSafeInteger(proof.transport_request_bytes)&&Number(proof.transport_request_bytes)>0&&Number.isSafeInteger(proof.transport_response_bytes)&&Number(proof.transport_response_bytes)>0&&Array.isArray(proof.batches),'ADMIN_WORKSPACE_SERIAL_PROOF_INVALID');
 assert.ok(applied?proof.commit_acknowledged===true&&proof.batches!.length>0:proof.commit_acknowledged===false&&proof.batches!.length===0,'ADMIN_WORKSPACE_SERIAL_WRITE_SCOPE_MISMATCH');
}
export function assertAdminWorkspaceDryRun(report:Record<string,unknown>,sqlSha:string):void {
 assert.ok(report.passed===true&&report.checks_passed===true&&report.applied===false&&!report.failure,'ADMIN_WORKSPACE_SUCCESSFUL_DRY_RUN_REQUIRED');
 assert.equal(report.sql_sha256,sqlSha,'DRY_RUN_SQL_MISMATCH');assertAdminWorkspaceSerialProof(report.serial,false);
}
/** Persist success only after native transport exit and MySQL CLOSE evidence.
 * Call from finally; a failed body keeps its original failure and passed=false.
 */
export async function closeAdminWorkspaceReport(report:Record<string,unknown>,close:()=>Promise<SerialSessionEvidence>):Promise<void> {
 report.passed=false;
 try{
  report.serial=await close();assertAdminWorkspaceSerialProof(report.serial,report.applied===true);
  report.passed=report.checks_passed===true&&!report.failure;
 }catch(error){report.failure??='ADMIN_WORKSPACE_TRANSPORT_NOT_VERIFIED';throw error;}
}
