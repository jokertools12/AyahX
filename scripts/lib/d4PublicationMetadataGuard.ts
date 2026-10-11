import assert from 'node:assert/strict';
interface PublicationSqlPlan {decisions?:Array<{id?:unknown;metadata_change_planned?:unknown}>;mutations?:Array<{id?:unknown;action?:unknown;table?:unknown}>}
/** Sensitive scoped publication metadata is accepted only in its audited publication plan. */
export function assertScopedPublicationMetadata(statement:string,plan:PublicationSqlPlan):void{
  if(!statement.startsWith('UPDATE recitations SET '))return;
  const body=statement.slice('UPDATE recitations SET '.length),columns:string[]=[];let quote='',depth=0,start=0,end=-1;
  const field=(part:string)=>{const match=/^([a-z_]+)\s*=/u.exec(part.trim());assert.ok(match,'UNPARSEABLE_RECITATION_ASSIGNMENT');columns.push(match[1]);};
  for(let i=0;i<body.length;i++){
    const c=body[i];
    if(quote){if(c==='\\')i++;else if(c===quote){if(body[i+1]===quote)i++;else quote='';}continue;}
    if(c==="'"||c==='"'||c==='`'){quote=c;continue;}
    if(c==='(')depth++;else if(c===')')depth--;
    else if(depth===0&&c===','){field(body.slice(start,i));start=i+1;}
    else if(depth===0&&body.slice(i,i+7)===' WHERE '){field(body.slice(start,i));end=i+7;break;}
  }
  assert.ok(end>=0&&!quote&&depth===0,'UNPARSEABLE_RECITATION_UPDATE');
  if(!columns.includes('licensed_publication_details'))return; // Existing catalog offset plans remain separate.
  assert.ok(columns.every(k=>['licensed_publication_details','audio_mode','timing_quality','status','published_by','published_at'].includes(k)),'PUBLICATION_METADATA_COLUMN_NOT_APPROVED');
  const where=body.slice(end),idMatch=/^id=CONVERT\(X'([a-f0-9]+)' USING utf8mb4\) COLLATE utf8mb4_unicode_ci;$/u.exec(where);
  assert.ok(idMatch&&idMatch[1].length%2===0,'PUBLICATION_SINGLE_RECITATION_REQUIRED');const id=Buffer.from(idMatch[1],'hex').toString('utf8');
  assert.equal(Buffer.from(id,'utf8').toString('hex'),idMatch[1],'PUBLICATION_IDENTIFIER_INVALID');
  assert.ok(plan.decisions?.some(d=>d.id===id&&d.metadata_change_planned===true),'PUBLICATION_DECISION_REQUIRED');
  assert.ok(plan.mutations?.some(m=>m.id===id&&m.action==='recitation.technical_publication'&&m.table==='recitation'),'PUBLICATION_AUDIT_REQUIRED');
}
