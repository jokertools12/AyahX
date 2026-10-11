const dirtyForms=new Set<symbol>();
export function markAdminForm(key:symbol,dirty:boolean){if(dirty)dirtyForms.add(key);else dirtyForms.delete(key);}
export function allowAdminNavigation(){return !dirtyForms.size||window.confirm(document.documentElement.lang==='en'?'Discard unsaved changes?':'تجاهل التغييرات غير المحفوظة؟');}
