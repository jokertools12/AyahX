import { Crown, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';

interface PremiumBadgeProps {
  size?: 'sm' | 'md';
  showLock?: boolean;
}

export function PremiumBadge({ size = 'sm', showLock = false }: PremiumBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/pricing">
          <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-primary/20 transition-colors text-xs">
            {showLock ? <Lock className="h-3 w-3" /> : <Crown className="h-3 w-3" />}
            <span>مميز</span>
          </Badge>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <p>هذه الميزة متاحة للأعضاء المميزين فقط</p>
      </TooltipContent>
    </Tooltip>
  );
}
