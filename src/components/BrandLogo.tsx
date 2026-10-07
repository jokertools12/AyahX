import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  variant?: 'horizontal' | 'stacked' | 'symbol' | 'app';
  tone?: 'auto' | 'white' | 'black';
  className?: string;
  decorative?: boolean;
  priority?: boolean;
}

/** Theme variants use the approved masters, without distorting or recoloring them. */
export function BrandLogo({ variant = 'horizontal', tone = 'auto', className, decorative = false, priority = false }: BrandLogoProps) {
  const dimensions = variant === 'horizontal' ? [808, 250] : variant === 'stacked' ? [590, 477] : variant === 'symbol' ? [264, 258] : [256, 256];
  const source = variant === 'horizontal'
    ? tone === 'white' ? BRAND.assets.horizontalWhite : tone === 'black' ? BRAND.assets.horizontalBlack : BRAND.assets.horizontal
    : variant === 'stacked' ? BRAND.assets.stacked : variant === 'app' ? BRAND.assets.appIcon : BRAND.assets.symbol;
  const imageClass = 'block h-auto w-full object-contain';
  const alt = decorative ? '' : BRAND.name;
  return (
    <span className={cn('inline-block shrink-0 align-middle', variant === 'horizontal' ? 'w-40' : 'w-16', className)} dir="ltr">
      <img src={source} alt={alt} width={dimensions[0]} height={dimensions[1]} decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        className={cn(imageClass, variant === 'horizontal' && tone === 'auto' && 'dark:hidden')} />
      {variant === 'horizontal' && tone === 'auto' && (
        <img src={BRAND.assets.horizontalWhite} alt={alt} width={808} height={250} decoding="async"
          loading={priority ? 'eager' : 'lazy'} className={cn(imageClass, 'hidden dark:block')} />
      )}
    </span>
  );
}
