// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {assertAdminWorkspaceDryRun,assertAdminWorkspaceSerialProof,closeAdminWorkspaceReport} from '../../scripts/lib/adminWorkspaceMigrationProof';
import type {SerialSessionEvidence} from '../../scripts/lib/railwayMysqlSession';
const serial=(applied=false):SerialSessionEvidence=>({ssh_exit_code:0,ssh_signal:null,stderr_redacted:'',compression:'gzip',mysql_close_acknowledged:true,commit_acknowledged:applied,acknowledged_commands:7,writes_halted:false,batches:applied?[{ordinal:1,row_count:0,sql_sha256:'a'.repeat(64),threads_connected:1,max_connections:151}]:[],transport_request_bytes:100,transport_response_bytes:200});
const report=()=>({applied:false,passed:true,checks_passed:true,sql_sha256:'fixed-sql',serial:serial()} as Record<string,unknown>);
describe('admin workspace report success includes native transport completion',()=>{
 it('keeps passed=false until the CLOSE and SSH-exit proof resolves',async()=>{
  const value=report();let resolve!:(value:SerialSessionEvidence)=>void;const close=vi.fn(()=>new Promise<SerialSessionEvidence>(accept=>{resolve=accept;}));
  const pending=closeAdminWorkspaceReport(value,close);expect(value.passed).toBe(false);resolve(serial());await pending;expect(value.passed).toBe(true);
 });
 it('retains failed=false evidence when close throws even after all database checks passed',async()=>{
  const value=report();await expect(closeAdminWorkspaceReport(value,async()=>{throw new Error('RAILWAY_SSH_EXIT_TIMEOUT');})).rejects.toThrow('RAILWAY_SSH_EXIT_TIMEOUT');expect(value).toMatchObject({passed:false,failure:'ADMIN_WORKSPACE_TRANSPORT_NOT_VERIFIED'});
  expect(()=>assertAdminWorkspaceDryRun(value,'fixed-sql')).toThrow();
 });
 it.each([{ssh_exit_code:1},{ssh_signal:'SIGTERM'},{mysql_close_acknowledged:false},{writes_halted:true},{compression:null},{acknowledged_commands:0},{transport_response_bytes:0}])('rejects invalid close evidence %o',async(change)=>{
  const value=report();await expect(closeAdminWorkspaceReport(value,async()=>({...serial(),...change} as SerialSessionEvidence))).rejects.toThrow();expect(value.passed).toBe(false);
 });
 it('cannot rehabilitate failed migration checks just because close succeeds',async()=>{
  const value={...report(),checks_passed:false,failure:'POST_CHECKSUM_CHANGED:users'};await closeAdminWorkspaceReport(value,async()=>serial());expect(value).toMatchObject({passed:false,failure:'POST_CHECKSUM_CHANGED:users'});
 });
 it('requires complete dry-run serial evidence and the same SQL fingerprint',()=>{
  expect(()=>assertAdminWorkspaceDryRun(report(),'fixed-sql')).not.toThrow();
  for(const change of [{serial:undefined},{checks_passed:undefined},{failure:'ANY_FAILURE'},{applied:true}])expect(()=>assertAdminWorkspaceDryRun({...report(),...change},'fixed-sql')).toThrow();
  expect(()=>assertAdminWorkspaceDryRun(report(),'different-sql')).toThrow('DRY_RUN_SQL_MISMATCH');
 });
 it('requires a write COMMIT for apply and prohibits write batches in the dry run',()=>{
  expect(()=>assertAdminWorkspaceSerialProof(serial(true),true)).not.toThrow();expect(()=>assertAdminWorkspaceSerialProof(serial(),true)).toThrow('ADMIN_WORKSPACE_SERIAL_WRITE_SCOPE_MISMATCH');expect(()=>assertAdminWorkspaceSerialProof(serial(true),false)).toThrow('ADMIN_WORKSPACE_SERIAL_WRITE_SCOPE_MISMATCH');
 });
});
