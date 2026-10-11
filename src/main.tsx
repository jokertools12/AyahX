import { createRoot } from "react-dom/client";
import {lazy, Suspense} from 'react';
import "./index.css";
const PublicApp=lazy(()=>import('./App'));
const AdminEntry=lazy(()=>import('./admin/AdminEntry'));
const Entry=location.pathname==='/admin'||location.pathname.startsWith('/admin/')?AdminEntry:PublicApp;
createRoot(document.getElementById("root")!).render(<Suspense fallback={<div role="status" aria-label="جار التحميل"/>}><Entry/></Suspense>);
