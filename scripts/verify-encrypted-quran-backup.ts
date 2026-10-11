/** Root-only local restore of a completed age archive. No Railway mutation. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {identifier,type Inventory,ENVIRONMENTS} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
const archive=resolve(option('--archive')),key=resolve(option('--key')),database=option('--db-name'),out=resolve(option('--out'));
assert.match(database,/^ayahx_d2_[a-z0-9_]+$/u);
for(const path of [archive,key,out]){const rel=relative(process.cwd(),path);assert.ok(rel.startsWith('..')||isAbsolute(rel),'PRIVATE_PATH_REQUIRED');}
const inventory=JSON.parse(await readFile(option('--inventory'),'utf8')) as Inventory;
assert.equal(inventory.environment_id,ENVIRONMENTS.production);assert.equal(inventory.mysql_version,'9.7.2');
const encryptedSha=createHash('sha256').update(await readFile(archive)).digest('hex');
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',charset:'utf8mb4'});
const completion=(child:ReturnType<typeof spawn>,label:string)=>new Promise<void>((accept,reject)=>{child.stderr?.resume();child.once('error',()=>reject(new Error(label+'_START_FAILED')));child.once('close',code=>code===0?accept():reject(new Error(label+'_EXIT_'+code)));});
try{
  const [version]=await db.query<RowDataPacket[]>('SELECT VERSION() AS version');assert.equal(version[0].version,'9.7.2');
  const [existing]=await db.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[database]);assert.equal(existing.length,0,'RESTORE_NAME_COLLISION');
  await db.query('CREATE DATABASE '+identifier(database)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  const decrypt=spawn(option('--age'),['-d','-i',key,archive],{stdio:['ignore','pipe','pipe']});
  const restore=spawn(option('--mysql'),['--host=127.0.0.1','--port=33319','--user=root','--default-character-set=utf8mb4',database],{stdio:['pipe','ignore','pipe']});
  let streamFailed=false,bytes=0;const hash=createHash('sha256');restore.stdin.on('error',()=>{streamFailed=true;});decrypt.stdout.on('data',(b:Buffer)=>{hash.update(b);bytes+=b.length;});decrypt.stdout.pipe(restore.stdin);
  await Promise.all([completion(decrypt,'AGE_DECRYPT'),completion(restore,'MYSQL_RESTORE')]);assert.equal(streamFailed,false);assert.ok(bytes>1000);
  await db.query('USE '+identifier(database));const counts:Record<string,number>={},checksums:Record<string,string|null>={};
  for(const table of inventory.tables){const [rows]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM '+identifier(table.name));const [sums]=await db.query<RowDataPacket[]>('CHECKSUM TABLE '+identifier(table.name));counts[table.name]=Number(rows[0].count);checksums[table.name]=sums[0].Checksum===null?null:String(sums[0].Checksum);assert.equal(counts[table.name],inventory.row_counts[table.name],'RESTORE_COUNT:'+table.name);assert.equal(checksums[table.name],inventory.checksums[table.name],'RESTORE_CHECKSUM:'+table.name);}
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),encryptedSha,'ARCHIVE_CHANGED');
  await writeFile(out,JSON.stringify({checked_at:new Date().toISOString(),mysql_version:'9.7.2',encrypted_path:archive,encrypted_sha256:encryptedSha,plaintext_sha256:hash.digest('hex'),plaintext_bytes:bytes,plaintext_written_to_disk:false,restored_and_verified:true,restored_tables:inventory.tables.length,row_counts:counts,checksums,database,production_writes:0},null,2)+'\n');
  console.log(JSON.stringify({restored_and_verified:true,mysql:'9.7.2',tables:inventory.tables.length,production_writes:0}));
}finally{await db.end();}
