import {useSearchParams} from 'react-router-dom';
import {useAdmin,useText} from '../../adminState';
import {PageHeader,ErrorState,LoadingState,EmptyState} from '../../ui/AdminPrimitives';
import {SearchCombobox} from '../../ui/AdminInteractions';
import {useCatalogResource} from './catalogHooks';
import {type CatalogRecitation} from './catalogTypes';
import AvailabilityPanel from './AvailabilityPanel';
import './catalog.css';
export default function AvailabilityPage(){const t=useText(),{lang}=useAdmin(),[params,setParams]=useSearchParams(),query=useCatalogResource<CatalogRecitation[]>('/recitations?limit=100'),rows=query.data?.data??[],id=params.get('recitation_id')??rows[0]?.id??'';return <div className="admin-stack"><PageHeader title={t('مصفوفة إتاحة السور','Chapter availability matrix')} description={t('114 سورة؛ تنقّل بالأسهم وHome وEnd وافتح التفاصيل بالنقر أو Enter.','114 chapters; use arrows, Home and End, and open details with click or Enter.')}/>{query.isPending?<LoadingState/>:query.error?<ErrorState error={query.error} onRetry={()=>void query.refetch()}/>:rows.length?<><SearchCombobox label={t('اختيار التلاوة','Choose recitation')} value={id} options={rows.map(r=>({value:r.id,label:lang==='ar'?r.display_label_ar??r.generated_label_ar:r.display_label_en??r.generated_label_en}))} onChange={value=>setParams({recitation_id:value})}/><AvailabilityPanel recitationId={id}/></>:<EmptyState text={t('لا توجد تلاوات في المكتبة','No recitations in the library')}/>}</div>;}
