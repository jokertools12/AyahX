import {useState} from 'react';
import {PageHeader,ErrorState} from '../../ui/AdminPrimitives';
import {Pagination} from '../../ui/DataTable';
import {useAdmin,useText} from '../../adminState';
import {useAdminList} from '../../useAdminList';
import {catalogListKeys,useCatalogResource,usePermission,useCatalogSort} from './catalogHooks';
import {CatalogFilters} from './CatalogFilters';
import {commonCatalogFilters} from './catalogFilterModel';
import {type CatalogRecitation,type CatalogProvider} from './catalogTypes';
import RecitationTable from './RecitationTable';
import RecitationDrawer from './RecitationDrawer';
import './catalog.css';
export default function RecitationsPage(){const t=useText(),{lang}=useAdmin(),sort=useCatalogSort(),list=useAdminList<CatalogRecitation>('/catalog/recitations',catalogListKeys),providers=useCatalogResource<CatalogProvider[]>('/providers?limit=100',usePermission('providers.read'));const [selected,setSelected]=useState<CatalogRecitation|null>(null);return <div className="admin-stack"><PageHeader title={t('التلاوات والمصادر','Recitations and sources')} description={t('الظهور العام مستقل عن الأهلية التقنية، ويحتاج تحقق الصوت والحقوق.','Public visibility is separate from technical eligibility and requires voice and license verification.')}/>{providers.error&&<ErrorState error={providers.error} onRetry={()=>void providers.refetch()}/>}<CatalogFilters params={list.params} set={list.set} filters={commonCatalogFilters.filter(f=>f.key!=='featured')} providerOptions={(providers.data?.data??[]).map(p=>({value:p.code,label:p.name}))}/><RecitationTable rows={list.rows} loading={list.query.isPending} error={list.query.error??undefined} retry={()=>void list.query.refetch()} onSelect={setSelected} ordered={(list.params.get('sort')??'sort_order')==='sort_order'&&(list.params.get('direction')??'asc')==='asc'} sortKey={list.params.get('sort')??'sort_order'} sortDirection={list.params.get('direction')==='desc'?'desc':'asc'} onSort={sort}/><Pagination page={list.page} total={list.total} limit={list.limit} lang={lang} onChange={p=>list.set('page',String(p))}/><RecitationDrawer row={selected?list.rows.find(r=>r.id===selected.id)??selected:null} onClose={()=>setSelected(null)}/></div>;}
