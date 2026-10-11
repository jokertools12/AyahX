/** Root read-only: compare names and server hashes; never emit setting values. */
import { writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {readSql,ENVIRONMENTS} from './lib/railwayQuranOps';
const local=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d2_d7_restored_20261011'});
try{
 const [previous]=await local.query<mysql.RowDataPacket[]>('SELECT key_name,is_secret,SHA2(value_text,256) value_hash,updated_at FROM system_settings ORDER BY key_name');
 const current=(await readSql(ENVIRONMENTS.production,"SELECT JSON_OBJECT('key_name',key_name,'is_secret',is_secret,'value_hash',SHA2(value_text,256),'updated_at',updated_at) FROM system_settings ORDER BY key_name;")).trim().split(/\r?\n/u).map(line=>JSON.parse(line));
 const changes=current.filter(row=>!previous.some(old=>old.key_name===row.key_name&&old.value_hash===row.value_hash&&old.is_secret===row.is_secret));
 const audit=(await readSql(ENVIRONMENTS.production,"SELECT JSON_OBJECT('action',action,'entity_type',entity_type,'created_at',created_at) FROM audit_logs WHERE created_at>'2026-10-11 17:10:00' ORDER BY id;")).trim();
 const result={checked_at:new Date().toISOString(),production_writes:0,previous_count:previous.length,current_count:current.length,changes,audit: audit?audit.split(/\r?\n/u).map(line=>JSON.parse(line)):[]};
 await writeFile('docs/data/d7-settings-drift.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await local.end();}
