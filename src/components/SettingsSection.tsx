import type { ReactNode } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Native disclosure keeps forms and local component state mounted when closed. */
export function SettingsSection({ title, description, children, className, defaultOpen = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen || undefined} className={cn('group/settings min-w-0 rounded-xl border border-border bg-card text-card-foreground', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3.5 text-start outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Settings2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/settings:rotate-180" aria-hidden="true" />
      </summary>
      <div className="min-w-0 border-t border-border/60 p-3 sm:p-4">{children}</div>
    </details>
  );
}
