import type { DisplaySettings } from '@/components/DisplaySettingsPanel';

export type VisualDirectionId = 'dawn' | 'editorial' | 'moonlit';

export interface VisualDirection {
  id: VisualDirectionId;
  name: string;
  subtitle: string;
  description: string;
  gradient: string;
  accent: string;
  starterBackgroundId: string;
  displaySettings: Partial<DisplaySettings>;
}

export const VISUAL_DIRECTIONS: readonly VisualDirection[] = [
  {
    id: 'dawn',
    name: 'فجر ذهبي',
    subtitle: 'بوابة معمارية • كهرماني',
    description: 'إضاءة دافئة وقوس سينمائي يضع الآية في مركز المشهد.',
    gradient: 'radial-gradient(circle at 70% 18%, #e7a364 0%, #43516f 34%, #091126 82%)',
    accent: '#e7a364',
    starterBackgroundId: 'mosque-1',
    displaySettings: { visualDesign: 'dawn', textShadowStyle: 'soft', highlightStyle: 'glow', glowStyle: 'golden', frameStyle: 'none', screenBorderStyle: 'none' },
  },
  {
    id: 'editorial',
    name: 'مصحف تحريري',
    subtitle: 'إطار زمردي • ورق عاجي',
    description: 'هدوء تحريري نظيف مناسب للآيات الطويلة والهوية الراقية.',
    gradient: 'radial-gradient(circle at 50% 32%, #eee4bd 0%, #39755e 28%, #081419 82%)',
    accent: '#b6d79d',
    starterBackgroundId: 'mosque-1',
    displaySettings: { visualDesign: 'editorial', textShadowStyle: 'soft', highlightStyle: 'underline', glowStyle: 'emerald', frameStyle: 'minimal', screenBorderStyle: 'none' },
  },
  {
    id: 'moonlit',
    name: 'أفق قمري',
    subtitle: 'هلال أزرق • فضي هادئ',
    description: 'مزاج ليلي تأملي بهلال فضي وأفق أزرق عميق.',
    gradient: 'radial-gradient(circle at 58% 10%, #e9f7ff 0%, #527cc0 14%, #112d64 42%, #04091e 84%)',
    accent: '#a8cfff',
    starterBackgroundId: 'stars-img-1',
    displaySettings: { visualDesign: 'moonlit', textShadowStyle: 'soft', highlightStyle: 'glow', glowStyle: 'soft', frameStyle: 'none', screenBorderStyle: 'subtleVignette' },
  },
];

export function getVisualDirection(id: string | null | undefined): VisualDirection {
  return VISUAL_DIRECTIONS.find((direction) => direction.id === id) || VISUAL_DIRECTIONS[0];
}
