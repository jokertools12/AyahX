import {toast} from 'sonner';
export async function copy(value:string){try{await navigator.clipboard.writeText(value);toast.success('تم النسخ');}catch{toast.error('تعذر النسخ؛ حدّد النص وانسخه يدويًا');}}
