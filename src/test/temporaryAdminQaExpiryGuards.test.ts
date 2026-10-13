// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {createQaAccount,prepareQaAccount,parseQaRows} from '../../scripts/temporary-admin-qa';
import type {CatalogDatabase,CatalogTx} from '../../server/services/catalogContracts';
vi.mock('bcryptjs',()=>({default:{hash:vi.fn(async()=>'$synthetic-password-hash')}}));

/** Synthetic clock/event/transaction doubles only; no DB or Railway sessions. */
function fixture(clocks=[600000000,600000000,600000000],eventStatus='ENABLED'){
 const account=prepareQaAccount('local'),expires=account.expiresAt.slice(0,19).replace('T',' ');
 let body='',rolledBack=false,committed=false;const staged:string[]=[],persisted:string[]=[],clockReads:string[]=[];
 const read=async(sql:string)=>{
  if(sql.includes('TIMESTAMPDIFF')){clockReads.push(sql);return[{remaining_us:clocks.shift()??600000000,scheduler_enabled:'ON'}];}
  if(sql.includes('@@event_scheduler'))return[{enabled:'ON'}];
  if(sql.startsWith('SELECT EVENT_DEFINITION,STATUS'))return[{EVENT_DEFINITION:body,STATUS:eventStatus,TIME_ZONE:'+00:00',expires}];
  if(sql.startsWith('SELECT STATUS'))return[{STATUS:'ENABLED',TIME_ZONE:'+00:00'}];
  return[];
 };
 const tx:CatalogTx={read,execute:async sql=>{staged.push(sql);}};
 const db:CatalogDatabase={read,execute:async sql=>{if(sql.startsWith('CREATE EVENT'))body=sql.split(' DO ')[1];},transaction:async work=>{
  try{const result=await work(tx);persisted.push(...staged);committed=true;return result;}catch(error){rolledBack=true;throw error;}
 }};
 return{db,account,persisted,staged,clockReads,state:()=>({rolledBack,committed,body})};
}
describe('temporary QA provisioning uses the exact event and MySQL UTC deadline',()=>{
 it('accepts a sufficient window and validates before inserts and immediately before commit',async()=>{
  const f=fixture(),password=f.account.password,expires=f.account.expiresAt;await createQaAccount(f.db,f.account);
  expect(f.account.state).toBe('active');expect(f.clockReads).toHaveLength(3);expect(f.state().committed).toBe(true);expect(f.persisted.some(sql=>sql.startsWith('INSERT INTO users'))).toBe(true);expect(f.persisted).toContainEqual(expect.stringContaining("VALUES(?,?,'analyst')"));expect(f.persisted).not.toContainEqual(expect.stringContaining("VALUES(?,?,'admin')"));expect(f.account.password).toBe(password);expect(f.account.expiresAt).toBe(expires);
 });
 it.each([0,119999999])('rejects %s microseconds of provisioning time before installing an event or user',async(remaining)=>{
  const f=fixture([remaining]);await expect(createQaAccount(f.db,f.account)).rejects.toThrow('QA_PROVISIONING_WINDOW_REQUIRED');expect(f.account.state).toBe('prepared');expect(f.persisted).toEqual([]);expect(f.staged).toEqual([]);expect(f.state().body).toBe('');
 });
 it('rejects an event/deadline race before the first user insert',async()=>{
  const f=fixture([600000000,0]);await expect(createQaAccount(f.db,f.account)).rejects.toThrow('QA_PROVISIONING_WINDOW_REQUIRED');expect(f.staged).toEqual([]);expect(f.state()).toMatchObject({rolledBack:true,committed:false});expect(f.account.state).toBe('prepared');
 });
 it('rolls back all staged users, roles and audit when time expires before commit',async()=>{
  const f=fixture([600000000,600000000,0]);await expect(createQaAccount(f.db,f.account)).rejects.toThrow('QA_PROVISIONING_WINDOW_REQUIRED');expect(f.staged.some(sql=>sql.startsWith('INSERT INTO user_roles'))).toBe(true);expect(f.persisted).toEqual([]);expect(f.state()).toMatchObject({rolledBack:true,committed:false});expect(f.account.state).toBe('prepared');
 });
 it('rejects the one-shot owned event if it has already become disabled despite a future deadline',async()=>{
  const f=fixture(undefined,'DISABLED');await expect(createQaAccount(f.db,f.account)).rejects.toThrow('QA_EXPIRY_EVENT_NOT_ENABLED');expect(f.staged).toEqual([]);expect(f.account.state).toBe('prepared');
 });
 it('fails closed for a missing owned event instead of assuming installed means enabled',async()=>{
  const f=fixture(),transaction=f.db.transaction;
  f.db.transaction=async work=>transaction(async tx=>work({...tx,read:async(sql,params)=>sql.startsWith('SELECT EVENT_DEFINITION,STATUS')?[]:tx.read(sql,params)}));
  await expect(createQaAccount(f.db,f.account)).rejects.toThrow('QA_EXPIRY_EVENT_MISMATCH');expect(f.persisted).toEqual([]);
 });
 it('parses only registered CLI result shapes for UTC and owned-event guards',()=>{
  expect(parseQaRows('SELECT TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(6),CAST(? AS DATETIME(6))) remaining_us,@@event_scheduler scheduler_enabled','120000000\tON\n')).toEqual([{remaining_us:'120000000',scheduler_enabled:'ON'}]);
  expect(parseQaRows('SELECT EVENT_DEFINITION,STATUS,TIME_ZONE,DATE_FORMAT(EXECUTE_AT,...) expires','BEGIN fixed owned expiry END\tENABLED\t+00:00\t2026-10-13 23:00:00\n')).toEqual([{EVENT_DEFINITION:'BEGIN fixed owned expiry END',STATUS:'ENABLED',TIME_ZONE:'+00:00',expires:'2026-10-13 23:00:00'}]);
  expect(()=>parseQaRows('SELECT password_hash FROM users','never')).toThrow('QA_SQL_RESULT_SHAPE_UNREGISTERED');
 });
});
