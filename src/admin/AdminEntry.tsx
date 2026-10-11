import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {BrowserRouter} from 'react-router-dom';
import {TooltipProvider} from '@/components/ui/tooltip';
import {Toaster} from '@/components/ui/sonner';
import AdminRoot from './AdminRoot';
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,staleTime:15000}}});
export default function AdminEntry(){return <QueryClientProvider client={client}><TooltipProvider><BrowserRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><AdminRoot/></BrowserRouter><Toaster/></TooltipProvider></QueryClientProvider>;}
