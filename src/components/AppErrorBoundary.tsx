import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/** Keeps a recoverable UI on screen when a route or browser API fails. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application render error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6" dir="rtl">
        <section className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-card p-8 text-center shadow-xl" role="alert" aria-live="assertive">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold">حدث خطأ مؤقت في الصفحة</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            لم نفقد مهمة إنتاج الفيديو. يمكنك إعادة فتح الصفحة ومتابعة حالة المهمة تلقائياً.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => window.location.reload()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              إعادة تحميل الصفحة
            </Button>
            <Button variant="outline" onClick={() => window.location.assign('/')} className="gap-2">
              <Home className="h-4 w-4" />
              الرئيسية
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
