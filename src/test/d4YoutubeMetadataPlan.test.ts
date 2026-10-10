import {describe,expect,it} from 'vitest';
import {appendFileSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openYoutubeCheckpoint,prepareYoutubeMetadataSql,recordYoutubeAttempt,recordYoutubeMetadata,retryAfterDeadline,sanitizeYoutubeMetadata,youtubeChapters} from '../../scripts/lib/d4YoutubeMetadataPlan';
const chapters=youtubeChapters([{recitation_id:'r',slug:'reader',surah:1,url:'https://www.youtube.com/watch?v=abcdefghijk&list=PLabcdefghij'}]);
const metadata=sanitizeYoutubeMetadata({status:'available',checked_at:'2026-10-10T12:00:00.000Z',http_status:200,title:'Test',channel_title:'Owner',channel_url:'https://www.youtube.com/channel/UCabcdef',html:'<iframe>untrusted</iframe>',thumbnail_url:'https://remote/image'});
const path=()=>join(mkdtempSync(join(tmpdir(),'ayahx-yt-unit-')),'checkpoint.jsonl');
const decoded=(sql:string)=>sql.replace(/CONVERT\(X'([a-f0-9]+)' USING utf8mb4\)/gu,(_match,hex:string)=>"'"+Buffer.from(hex,'hex').toString('utf8')+"'");
describe('YouTube metadata evidence and deterministic plan',()=>{
  it('rejects nonofficial references and signed URLs; retains metadata only',()=>{
    expect(()=>youtubeChapters([{recitation_id:'r',slug:'reader',surah:1,url:'https://example.com/watch?v=abcdefghijk'}])).toThrow('REFERENCE_INVALID');
    expect(()=>youtubeChapters([{recitation_id:'r',slug:'reader',surah:1,url:'https://youtube.com/watch?v=abcdefghijk&token=secret'}])).toThrow();
    expect(metadata).not.toHaveProperty('html');expect(metadata).not.toHaveProperty('thumbnail_url');expect(metadata.channel_id).toBe('UCabcdef');
    expect(()=>sanitizeYoutubeMetadata({status:'available',checked_at:metadata.checked_at,channel_url:'https://evil.example/channel/UCabcdef'})).toThrow('CHANNEL_URL_INVALID');
  });
  it('honors both Retry-After formats and defaults safely for missing value',()=>{
    const now=Date.parse(metadata.checked_at);expect(retryAfterDeadline({...metadata,http_status:429,retry_after:'120'},now)).toBe(now+120000);
    expect(retryAfterDeadline({...metadata,http_status:429,retry_after:new Date(now+90000).toUTCString()},now)).toBe(now+90000);
    expect(retryAfterDeadline({...metadata,http_status:429,retry_after:null},now)).toBe(now+60000);expect(retryAfterDeadline(metadata,now)).toBe(0);
  });
  it('persists attempts and completed results immutably across resumption',()=>{
    const file=path(),state=openYoutubeCheckpoint(file,'a'.repeat(64));recordYoutubeAttempt(file,state,'abcdefghijk');recordYoutubeMetadata(file,state,'abcdefghijk',metadata,0);
    const before=readFileSync(file,'utf8'),resumed=openYoutubeCheckpoint(file,'a'.repeat(64));expect(resumed.results.get('abcdefghijk')).toEqual(metadata);
    expect(()=>recordYoutubeAttempt(file,resumed,'abcdefghijk')).toThrow('DUPLICATE_VIDEO');expect(readFileSync(file,'utf8')).toBe(before);
    expect(()=>openYoutubeCheckpoint(file,'b'.repeat(64))).toThrow('INPUT_CHANGED');
  });
  it('does not lose an in-flight attempt and refuses damaged checkpoint tails',()=>{
    const file=path(),state=openYoutubeCheckpoint(file,'a'.repeat(64));recordYoutubeAttempt(file,state,'abcdefghijk');expect(openYoutubeCheckpoint(file,'a'.repeat(64)).attempted.has('abcdefghijk')).toBe(true);
    appendFileSync(file,'{');expect(()=>openYoutubeCheckpoint(file,'a'.repeat(64))).toThrow('TRUNCATED');
    const other=path();openYoutubeCheckpoint(other,'a'.repeat(64));writeFileSync(other,readFileSync(other,'utf8').replace('manifest','tampered'));expect(()=>openYoutubeCheckpoint(other,'a'.repeat(64))).toThrow('HASH_INVALID');
  });
  it('creates inactive metadata references and unknown rights without altering audio health',()=>{
    const prepared=prepareYoutubeMetadataSql(chapters,new Map([['abcdefghijk',metadata]]),[],[],'0'.repeat(64));expect(prepared.youtube_changed).toBe(1);expect(prepared.source_changed).toBe(1);
    const sql=decoded(prepared.plan.finish().sql);expect(sql).toContain('recitation_youtube_sources');expect(sql).toContain("'unknown'");expect(sql).toContain('is_active');expect(sql).toContain('youtube_metadata_ok');expect(sql).not.toContain('UPDATE recitation_chapters');expect(sql).not.toContain('confirmed');
  });
  it('preserves human rights and ignores timestamp noise on idempotent replay',()=>{
    const yt={id:'yt',recitation_id:'r',surah:1,video_id:'abcdefghijk',playlist_id:'PLabcdefghij',channel_id:metadata.channel_id,channel_title:metadata.channel_title,oembed_status:'available',last_checked_at:'2000-01-01',rights_status:'owner_permission',rights_evidence_note:'human evidence'};
    const source={id:'src',recitation_id:'r',surah:1,url:chapters[0].url,kind:'provider_original',channel_title:metadata.channel_title,last_status:'youtube_metadata_ok',last_checked_at:'2000-01-01',is_active:1};
    const prepared=prepareYoutubeMetadataSql(chapters,new Map([['abcdefghijk',{...metadata,checked_at:'2026-10-11T12:00:00.000Z'}]]),[yt],[source],'0'.repeat(64));expect(prepared.plan.mutations).toHaveLength(0);expect(prepared.human_rights_preserved).toBe(1);
    const changed=prepareYoutubeMetadataSql(chapters,new Map([['abcdefghijk',{...metadata,channel_title:'Renamed'}]]),[yt],[source],'0'.repeat(64)).plan.finish().sql;
    expect(changed).not.toContain('rights_status=');expect(changed).not.toContain('rights_evidence_note=');expect(changed).not.toContain('is_active=');
  });
  it('refuses plans that silently omit an unchecked chapter',()=>{expect(()=>prepareYoutubeMetadataSql(chapters,new Map(),[],[],'0'.repeat(64))).toThrow('METADATA_INCOMPLETE');});
});
