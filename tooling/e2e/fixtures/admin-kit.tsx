/** Unit UI harness, outside the production entry graph. No API or auth bypass. */
import {createRoot} from 'react-dom/client';
import {TooltipProvider} from '../../../src/components/ui/tooltip';
import {Toaster} from '../../../src/components/ui/sonner';
import AdminKit from '../../../src/admin/AdminKit';
import '../../../src/index.css';
import '../../../src/admin/admin.css';
createRoot(document.getElementById('root')!).render(<TooltipProvider><div className="admin-app"><main className="admin-main"><AdminKit/></main><Toaster/></div></TooltipProvider>);
