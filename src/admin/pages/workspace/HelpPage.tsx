import GuideContent from './GuideContent';
import { useState } from 'react';
import { useAdmin, useText } from '../../adminState';
import { useAdminResource } from '../../useAdminResource';
import { PageHeader, LoadingState, ErrorState, Input, Field } from '../../ui/AdminPrimitives';
import { terms } from '../../i18n/terms';
import type { ProjectStatus } from '../../workspace/contracts';
export default function HelpPage() { const t = useText(), { lang } = useAdmin(), query = useAdminResource<ProjectStatus>('/project-status'), [search, setSearch] = useState(''); return <><PageHeader title={t('دليل الاستخدام والمصطلحات', 'Guide and glossary')} help="help" /><section className="admin-card admin-stack"><h2>{t('قاموس بسيط للمصطلحات', 'Plain language glossary')}</h2><Field id="glossary-search" label={t('ابحث عن مصطلح', 'Find a term')}><Input id="glossary-search" value={search} onChange={e => setSearch(e.target.value)} /></Field><dl className="catalog-definition">{Object.entries(terms).filter(([, item]) => (item.ar + item.en).toLowerCase().includes(search.toLowerCase())).map(([code, item]) => <div key={code}><dt>{item[lang]}</dt><dd>{item[lang === 'ar' ? 'help_ar' : 'help_en']}</dd></div>)}</dl></section><section className="admin-card admin-stack"><h2>{t('دليل الصفحات والخطوات', 'Pages and steps guide')}</h2>{query.isPending ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <GuideContent markdown={query.data!.data.guide_markdown}/>}</section></>; }
