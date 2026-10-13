import {timingBounds} from './catalogFormatting';
import {type CatalogTiming} from './catalogTypes';
import {useText} from '../../adminState';
import {useId} from 'react';
/** The diagram reads stored source coordinates; it never transforms render timing. */
export default function TimingTimeline({row}:{row:CatalogTiming}){
  const t=useText(),descriptionId=useId(),bounds=timingBounds(row);
  // Invalid stored spans remain available in the existing raw/table views;
  // the diagram must not turn NaN, reversed or fractional intervals into bars.
  const intervalValid=(from:number,to:number)=>Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>=0&&to>from;
  if(!bounds||row.words.some(([, ,from,to])=>!intervalValid(from,to))||row.segments.some(([from,to])=>!intervalValid(from,to)))return <p>{t('لا توجد فواصل زمنية صحيحة لعرض الرسم','No valid timing intervals to draw')}</p>;
  const scale=(n:number)=>50+(n-bounds.from)/(bounds.to-bounds.from)*900;
  return <div className="admin-stack">
    <section aria-label={t('حدود المخطط المخزّنة','Stored plot bounds')}><dl className="catalog-definition"><div><dt>{t('بداية المخطط','Plot start')}</dt><dd><code dir="ltr">{bounds.from} ms</code></dd></div><div><dt>{t('نهاية المخطط','Plot end')}</dt><dd><code dir="ltr">{bounds.to} ms</code></dd></div></dl></section>
    <div className="catalog-scroll" role="region" tabIndex={0} aria-label={t('مخطط التوقيتات المخزّنة القابل للتمرير','Scrollable stored timing plot')}><svg className="catalog-timeline" viewBox="0 0 1000 200" role="img" aria-label={t('الفواصل المخزنة للكلمات والمقاطع بالمللي ثانية','Stored word and segment intervals in milliseconds')} aria-describedby={descriptionId}><title>{t('توقيتات المصدر للقراءة فقط','Read-only source timings')}</title><desc id={descriptionId}>{t(`الإحداثيات ${row.coordinate}، من ${bounds.from} إلى ${bounds.to} مللي ثانية؛ الكلمات غير المربوطة مميزة.`,`Coordinates ${row.coordinate}, from ${bounds.from} to ${bounds.to} ms; unmapped words are marked.`)}</desc>{row.segments.map(([from,to],i)=><g key={'s'+i}><rect className="segment" x={scale(from)} width={Math.max(1,scale(to)-scale(from))} y="45" height="35"/><title>{t(`المقطع ${i+1}: ${from}–${to} مللي ثانية`,`Segment ${i+1}: ${from}–${to} ms`)}</title></g>)}{row.words.map(([legal,occurrence,from,to],i)=><g key={'w'+i}><rect className={legal===null?'unmapped':''} x={scale(from)} width={Math.max(1,scale(to)-scale(from))} y={100+(occurrence%2)*42} height="32"/><title>{t(`${legal===null?'كلمة غير مربوطة':`الكلمة ${legal}`}، التكرار ${occurrence}: ${from}–${to} مللي ثانية`,`${legal===null?'Unmapped word':`Word ${legal}`}, occurrence ${occurrence}: ${from}–${to} ms`)}</title></g>)}</svg></div>
    {row.segments.length>0&&<ul aria-label={t('الفواصل المخزّنة للمقاطع','Stored segment intervals')} className="admin-stack">{row.segments.map(([from,to],i)=><li key={i}>{t(`المقطع ${i+1}: `,`Segment ${i+1}: `)}<code dir="ltr">{from}–{to} ms</code></li>)}</ul>}
  </div>;
}
