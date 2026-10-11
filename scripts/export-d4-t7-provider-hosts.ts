/** Local read-only export from the reconciled real MySQL catalog; no legacy maps. */
import assert from 'node:assert/strict';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,sep} from 'node:path';
const option=(k:string)=>{const i=process.argv.indexOf(k);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
const output=resolve(option('--out')),outside=relative(process.cwd(),output);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_HOST_SNAPSHOT_REQUIRED');
const manifestBytes=readFileSync(option('--manifest')),manifest=JSON.parse(manifestBytes.toString('utf8'));
const connection=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d4_catalog_20261010',charset:'utf8mb4'});
try{
  const [rows]=await connection.query<RowDataPacket[]>('SELECT r.slug,p.host_allowlist FROM recitations r JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug');
  const hosts:Record<string,string[]>={};for(const slug of Object.keys(manifest.results).sort()){const r=rows.find(r=>r.slug===slug);assert.ok(r);const list=typeof r.host_allowlist==='string'?JSON.parse(r.host_allowlist):r.host_allowlist;assert.ok(Array.isArray(list)&&list.length);hosts[slug]=[...list].sort();}
  const bytes=Buffer.from(JSON.stringify(hosts,null,2)+'\n');if(existsSync(output))assert.deepEqual(readFileSync(output),bytes);else writeFileSync(output,bytes,{flag:'wx'});
  const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');console.log(JSON.stringify({manifest_sha256:sha(manifestBytes),selection_sha256:manifest.selection_sha256,hosts_sha256:sha(bytes),recitations:Object.keys(hosts).length,network_requests:0,db_writes:0}));
}finally{await connection.end();}
