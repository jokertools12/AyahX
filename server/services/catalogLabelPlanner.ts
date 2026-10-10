import {type CatalogRow} from './catalogContracts';
export interface LabelCatalogRow {id:string;slug:string;name_ar:string;name_en:string;style:string;provider_name:string;recording_year:number|null;display_label_ar:string|null;display_label_en:string|null;needs_label_review:boolean|number|null;human_edited:boolean}
const styles:Record<string,string>={murattal:'مرتل',mujawwad:'مجود',muallim:'معلم',taraweeh:'تراويح',children_repeat:'تكرار الأطفال'};
export function generateCatalogLabels(row:LabelCatalogRow):{ar:string;en:string;needs_review:boolean;reasons:string[]}{
  if(!row.name_ar?.trim()||!row.name_en?.trim()||!row.style?.trim()||!row.provider_name?.trim()||row.recording_year!==null&&(!Number.isSafeInteger(row.recording_year)||row.recording_year<1))throw new Error('CATALOG_LABEL_METADATA_INVALID');
  const year=row.recording_year===null?'':` (${row.recording_year})`,ar=`${row.name_ar} — ${styles[row.style]??row.style} — ${row.provider_name}${year}`,en=`${row.name_en} — ${row.style} — ${row.provider_name}${year}`;
  if(ar.length>255||en.length>255)throw new Error('CATALOG_LABEL_TOO_LONG');
  const reasons:string[]=[];if(!styles[row.style])reasons.push('STYLE_TRANSLATION_UNREVIEWED');
  if(row.slug==='maher_al_muaiqly_qdc'&&row.style==='mujawwad')reasons.push('LEGACY_MURATTAL_PINNED_QUD_MUJAWWAD');
  return {ar,en,needs_review:reasons.length>0,reasons};
}
/** Existing descriptive labels are preserved unless proven machine-generated. */
export function planCatalogLabels(rows:LabelCatalogRow[]):Array<{id:string;slug:string;patch:CatalogRow;reasons:string[];human_label_preserved:boolean}>{
  return rows.map(row=>{const generated=generateCatalogLabels(row),patch:CatalogRow={};
    if(!row.human_edited){if(row.display_label_ar===null||row.display_label_ar==='')patch.display_label_ar=generated.ar;if(row.display_label_en===null||row.display_label_en==='')patch.display_label_en=generated.en;}
    if(generated.needs_review&&row.needs_label_review!==true&&row.needs_label_review!==1)patch.needs_label_review=true;
    return {id:row.id,slug:row.slug,patch,reasons:generated.reasons,human_label_preserved:row.human_edited||Boolean(row.display_label_ar||row.display_label_en)};
  });
}
