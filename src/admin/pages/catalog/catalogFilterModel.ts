export interface CatalogFilter {key:string;ar:string;en:string;options:Array<{value:string;ar:string;en:string}>}
export const commonCatalogFilters:CatalogFilter[]=[
 {key:'riwayah',ar:'الرواية',en:'Riwayah',options:[]},
 {key:'style',ar:'الأسلوب',en:'Style',options:[]},
 {key:'source',ar:'نوع المصدر / القناة',en:'Source type / channel',options:[]},
 {key:'availability',ar:'الإتاحة',en:'Availability',options:['complete','near_complete','partial','unavailable'].map((value,i)=>({value,ar:['مكتمل','شبه مكتمل','جزئي','غير متاح'][i],en:['Complete','Near complete','Partial','Unavailable'][i]}))},
 {key:'voice',ar:'حالة الصوت',en:'Voice status',options:['unverified','auto_verified','confirmed','mismatch'].map((value,i)=>({value,ar:['غير متحقق','متحقق آليًا','مؤكد','غير مطابق'][i],en:['Unverified','Auto verified','Confirmed','Mismatch'][i]}))},
 {key:'license',ar:'الترخيص',en:'License',options:['unreviewed','permitted','restricted'].map((value,i)=>({value,ar:['غير مراجع','مسموح','مقيّد'][i],en:['Unreviewed','Permitted','Restricted'][i]}))},
 {key:'visible',ar:'الظهور',en:'Visibility',options:[{value:'true',ar:'ظاهر',en:'Visible'},{value:'false',ar:'مخفي',en:'Hidden'}]},
 {key:'featured',ar:'مميّز',en:'Featured',options:[{value:'true',ar:'نعم',en:'Yes'},{value:'false',ar:'لا',en:'No'}]},
];
