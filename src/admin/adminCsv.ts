export function exportCsv(rows:Array<Record<string,unknown>>,filename:string){
  if(!rows.length)return;const keys=Object.keys(rows[0]);const cell=(value:unknown)=>'"'+String(value??'').replace(/^[=+@-]/u,"'$&").replaceAll('"','""')+'"';
  const csv='\ufeff'+[keys.map(cell).join(','),...rows.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
