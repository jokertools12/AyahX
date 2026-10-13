import {type CatalogTiming} from './catalogTypes';
export function missingWordCount(value:unknown):number{if(!Array.isArray(value))return 0;return value.reduce((sum,item)=>sum+(item&&typeof item==='object'&&'words' in item&&Array.isArray(item.words)?item.words.length:0),0);}
/** Display stored coordinates as a diagram; no render-timeline conversion. */
export function timingBounds(row:CatalogTiming){const values=[...row.words.flatMap(w=>[w[2],w[3]]),...row.segments.flatMap(s=>[s[0],s[1]])].filter(n=>Number.isSafeInteger(n)&&n>=0);if(!values.length)return null;const from=Math.min(...values),to=Math.max(...values);return to>from?{from,to}:null;}
export const approvedFontNames=['Amiri','Amiri Quran','Noto Naskh Arabic','Scheherazade New','Lateef','Mada'] as const;
export function isApprovedFontUrl(url:string){return /^\/fonts\/[a-zA-Z0-9_.-]+\.(ttf|woff2?)$/u.test(url);}

export interface MissingWordEvidence { ayah: number | null; position: number; reason: string }
/** Project stored evidence only: no word reconstruction or Quran text changes. */
export function missingWordEvidence(value: unknown): MissingWordEvidence[] {
 if (!Array.isArray(value)) return [];
 const word = (item: unknown, ayah: number | null): MissingWordEvidence[] => Array.isArray(item) && Number.isInteger(item[0]) && typeof item[1] === 'string' ? [{ ayah, position: item[0], reason: item[1] }] : [];
 return value.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && Number.isInteger(item.ayah) && Array.isArray(item.words) ? item.words.flatMap((entry: unknown) => word(entry, item.ayah)) : word(item, null));
}
