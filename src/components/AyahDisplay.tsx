import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AyahDisplayProps {
  number: number;
  text: string;
  isHighlighted?: boolean;
  showNumber?: boolean;
  className?: string;
}

// Convert English numerals to Eastern Arabic Numerals (١، ٢، ٣...)
function toArabicNumerals(num: number): string {
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return num.toString().split('').map(d => arabicDigits[parseInt(d)] || d).join('');
}

export function AyahDisplay({
  number,
  text,
  isHighlighted,
  showNumber = true,
  className,
}: AyahDisplayProps) {
  const arabicNum = toArabicNumerals(number);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "rounded-xl p-4 transition-all duration-300 border border-border/40 bg-card/70 backdrop-blur-sm hover:border-primary/40 hover:bg-card/90 shadow-sm",
        isHighlighted && "border-amber-500/50 bg-amber-500/10 shadow-md",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-row-reverse">
        {/* Ayah Badge in Header */}
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
          <span>الآية</span>
          <span className="font-mono">{number}</span>
        </div>

        {/* Verse text in Quran Font */}
        <div className="flex-1 text-right">
          <p
            className="font-quran text-2xl md:text-3xl leading-[2.3] text-foreground tracking-wide select-text"
            dir="rtl"
            style={{ fontFamily: '"Amiri", "Scheherazade New", "Noto Naskh Arabic", serif' }}
          >
            {text}
            {showNumber && (
              <span className="inline-flex items-center justify-center mx-2 text-amber-500 font-bold text-xl select-none">
                <span className="text-amber-400/80">﴿</span>
                <span className="px-1 text-base text-amber-500 font-normal">{arabicNum}</span>
                <span className="text-amber-400/80">﴾</span>
              </span>
            )}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
