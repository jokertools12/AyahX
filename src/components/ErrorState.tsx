import { AlertCircle, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Accessible Error State component for data-fetching failures, network errors, and unexpected crashes.
 * Adheres to WCAG alert role and preserves the existing Shadcn UI / Radix design system.
 */
export function ErrorState({
  title = 'حدث خطأ في تحميل البيانات',
  message = 'تعذر الاتصال بالخادم أو جلب البيانات. يرجى التحقق من اتصالك بالإنترنت ثم إعادة المحاولة.',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <Card className={`border-destructive/30 bg-destructive/5 ${className}`} role="alert" aria-live="assertive">
      <CardContent className="p-8 text-center space-y-4">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mx-auto">
          <AlertCircle className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{message}</p>
        </div>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            className="gap-2 border-destructive/40 hover:bg-destructive/10 text-foreground"
            aria-label="إعادة المحاولة لتحميل البيانات"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            إعادة المحاولة
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
