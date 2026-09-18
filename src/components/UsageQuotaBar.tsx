import { Progress } from '@/components/ui/progress';
import { Video, Crown } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function UsageQuotaBar() {
  const { isAuthenticated } = useAuth();
  const { dailyUsage, isPremium, loading } = useSubscription();

  if (!isAuthenticated || loading) return null;

  const limit = dailyUsage.browserRenderLimit;
  const remaining = dailyUsage.browserRenderRemaining;
  const percentage = limit === null ? 0 : Math.min((dailyUsage.browserRenderCount / limit) * 100, 100);
  const isLow = limit !== null && (remaining ?? 0) <= 1 && !isPremium;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50">
          <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="w-16">
            <Progress value={percentage} className="h-1.5" />
          </div>
          <span className={`text-xs font-medium tabular-nums ${isLow ? 'text-destructive' : 'text-muted-foreground'}`}>
            {limit === null ? '∞' : `${remaining}/${limit}`}
          </span>
          {!isPremium && isLow && (
            <Link to="/pricing">
              <Crown className="h-3.5 w-3.5 text-amber-500" />
            </Link>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">
          {isPremium
            ? 'العضوية المميزة — Browser Canvas غير محدود'
            : `الخطة المجانية — ${remaining ?? 0} من 5 عمليات Browser Canvas متبقية اليوم`}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
