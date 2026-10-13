import {useQuery} from '@tanstack/react-query';
import {adminApi} from '../../adminApi';
import {useText} from '../../adminState';
import {ErrorState,LoadingState} from '../../ui/AdminPrimitives';
import {missingWordEvidence} from './catalogFormatting';
import {MissingWords} from './CatalogShared';
import type {CatalogTiming} from './catalogTypes';
/** Near-complete has at most three actual missing words: read their linked canonical text only. */
export default function ChapterMissingWords({value,recitationId,surah}:{value:unknown;recitationId:string;surah:number}){
 const t=useText(),words=missingWordEvidence(value),ayahs=[...new Set(words.map(word=>word.ayah).filter((ayah):ayah is number=>ayah!==null))].sort((a,b)=>a-b),bounded=words.length>0&&words.length<=3;
 const query=useQuery({queryKey:['admin','catalog','missing-canonical-words',recitationId,surah,ayahs.join(',')],enabled:bounded,retry:false,queryFn:async()=>{const result=new Map<string,string>();for(const ayah of ayahs){const response=await adminApi<CatalogTiming[]>(`/catalog/timings?recitation_id=${recitationId}&surah=${surah}&from=${ayah}&to=${ayah}&limit=1`);const row=response.data.find(item=>item.ayah===ayah);for(const word of row?.legal_words??[])result.set(`${ayah}:${word.position}`,word.text_uthmani);}return result;}});
 return <section className="admin-stack">{bounded&&query.isPending?<LoadingState/>:query.error?<ErrorState error={query.error} onRetry={()=>void query.refetch()}/>:null}<MissingWords value={value} canonicalWords={query.data}/>{bounded&&query.data&&words.some(word=>!query.data.has(`${word.ayah??''}:${word.position}`))&&<p>{t('بعض نصوص الكلمات القانونية غير متاحة من صفوف التوقيت المرتبطة؛ لا نَستعير نص رواية أخرى.','Some canonical words are unavailable from the linked timing rows. Text from another riwayah is never borrowed.')}</p>}</section>;
}
