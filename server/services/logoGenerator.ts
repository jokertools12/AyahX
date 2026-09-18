/**
 * server/services/logoGenerator.ts
 * Generates luxury Islamic seals, medallions, and logos in SVG vector format.
 * Can be augmented by Gemini AI or rendered using built-in procedural SVG generation.
 */

export interface LogoOptions {
  brandName: string;
  subtitle?: string;
  style?: 'goldMedallion' | 'ottomanCrest' | 'modernGeometric' | 'classicCalligraphy';
}

export function generateProceduralLogo(options: LogoOptions): string {
  const brand = (options.brandName || 'آيات قرآنية').trim();
  const sub = (options.subtitle || 'تلاوات خاشعة').trim();
  const style = options.style || 'goldMedallion';

  const size = 500;
  const cx = size / 2;
  const cy = size / 2;

  if (style === 'ottomanCrest') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
      <defs>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#BF953F"/>
          <stop offset="25%" stop-color="#FCF6BA"/>
          <stop offset="50%" stop-color="#B38728"/>
          <stop offset="75%" stop-color="#FBF5B7"/>
          <stop offset="100%" stop-color="#AA771C"/>
        </linearGradient>
        <radialGradient id="bgDark" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#141E15"/>
          <stop offset="70%" stop-color="#070C08"/>
          <stop offset="100%" stop-color="#020402"/>
        </radialGradient>
        <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>

      <!-- Background Circle -->
      <circle cx="${cx}" cy="${cy}" r="230" fill="url(#bgDark)" stroke="url(#goldGrad)" stroke-width="4"/>

      <!-- Crescent Arch -->
      <path d="M 250 50 A 200 200 0 1 0 440 300 A 185 185 0 1 1 250 50 Z" fill="url(#goldGrad)" opacity="0.85" filter="url(#goldGlow)"/>

      <!-- Inner Crest Border -->
      <circle cx="${cx}" cy="${cy}" r="195" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-dasharray="8 6"/>
      <circle cx="${cx}" cy="${cy}" r="185" fill="none" stroke="url(#goldGrad)" stroke-width="1"/>

      <!-- Top Crown / Star -->
      <path d="M 250 85 L 257 105 L 278 105 L 261 118 L 267 138 L 250 125 L 233 138 L 239 118 L 222 105 L 243 105 Z" fill="url(#goldGrad)"/>

      <!-- Brand Name Typography -->
      <text x="${cx}" y="245" text-anchor="middle" font-family="'Amiri', 'Scheherazade New', serif" font-weight="bold" font-size="44" fill="url(#goldGrad)" filter="url(#goldGlow)">
        ${brand}
      </text>

      <!-- Subtitle -->
      <text x="${cx}" y="310" text-anchor="middle" font-family="'Cairo', 'Tahoma', sans-serif" font-weight="600" font-size="18" fill="#FCF6BA" letter-spacing="3">
        ${sub}
      </text>

      <!-- Lower Decorative Ornament -->
      <path d="M 180 340 Q 250 365 320 340 Q 250 350 180 340 Z" fill="url(#goldGrad)"/>
      <circle cx="250" cy="355" r="4" fill="url(#goldGrad)"/>
    </svg>`;
  }

  if (style === 'modernGeometric') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
      <defs>
        <linearGradient id="goldG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFD700"/>
          <stop offset="50%" stop-color="#D4AF37"/>
          <stop offset="100%" stop-color="#996515"/>
        </linearGradient>
        <radialGradient id="cyberBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#0D1B2A"/>
          <stop offset="80%" stop-color="#060B11"/>
          <stop offset="100%" stop-color="#020406"/>
        </radialGradient>
        <filter id="neonGlow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Outer Diamond Shield -->
      <rect x="70" y="70" width="360" height="360" rx="30" fill="url(#cyberBg)" stroke="url(#goldG)" stroke-width="4" transform="rotate(45 250 250)"/>
      <rect x="90" y="90" width="320" height="320" rx="20" fill="none" stroke="url(#goldG)" stroke-width="1.5" stroke-dasharray="6 4" transform="rotate(45 250 250)"/>

      <!-- Inner Central Emblem -->
      <circle cx="250" cy="250" r="140" fill="#0D1B2A" fill-opacity="0.9" stroke="url(#goldG)" stroke-width="2"/>

      <!-- Corner Accents -->
      <circle cx="250" cy="45" r="6" fill="url(#goldG)" filter="url(#neonGlow)"/>
      <circle cx="250" cy="455" r="6" fill="url(#goldG)" filter="url(#neonGlow)"/>
      <circle cx="45" cy="250" r="6" fill="url(#goldG)" filter="url(#neonGlow)"/>
      <circle cx="455" cy="250" r="6" fill="url(#goldG)" filter="url(#neonGlow)"/>

      <!-- Typography -->
      <text x="250" y="240" text-anchor="middle" font-family="'Cairo', 'Amiri', sans-serif" font-weight="bold" font-size="40" fill="url(#goldG)" filter="url(#neonGlow)">
        ${brand}
      </text>
      <text x="250" y="295" text-anchor="middle" font-family="'Cairo', sans-serif" font-weight="500" font-size="16" fill="#E0E1DD" letter-spacing="4">
        ${sub}
      </text>
    </svg>`;
  }

  if (style === 'classicCalligraphy') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
      <defs>
        <linearGradient id="goldCallig" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFE066"/>
          <stop offset="50%" stop-color="#D4AF37"/>
          <stop offset="100%" stop-color="#8C6D1F"/>
        </linearGradient>
        <radialGradient id="darkVignette" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1A150D"/>
          <stop offset="85%" stop-color="#0D0904"/>
          <stop offset="100%" stop-color="#050301"/>
        </radialGradient>
      </defs>

      <!-- Background -->
      <circle cx="${cx}" cy="${cy}" r="235" fill="url(#darkVignette)" stroke="url(#goldCallig)" stroke-width="4"/>

      <!-- Floral Arabesque Ring -->
      <circle cx="${cx}" cy="${cy}" r="215" fill="none" stroke="url(#goldCallig)" stroke-width="2" stroke-dasharray="12 8"/>
      <circle cx="${cx}" cy="${cy}" r="200" fill="none" stroke="url(#goldCallig)" stroke-width="1"/>

      <!-- Calligraphic Center Piece -->
      <text x="${cx}" y="245" text-anchor="middle" font-family="'Amiri', 'Scheherazade New', serif" font-weight="bold" font-size="52" fill="url(#goldCallig)">
        ${brand}
      </text>

      <!-- Subtitle in Arch Shape or Center -->
      <text x="${cx}" y="315" text-anchor="middle" font-family="'Amiri', serif" font-size="22" fill="#F3E5AB">
        ﴿ ${sub} ﴾
      </text>
    </svg>`;
  }

  // Default: goldMedallion (Royal 8-pointed star seal)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
    <defs>
      <linearGradient id="primaryGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#BF953F"/>
        <stop offset="25%" stop-color="#FCF6BA"/>
        <stop offset="50%" stop-color="#B38728"/>
        <stop offset="75%" stop-color="#FBF5B7"/>
        <stop offset="100%" stop-color="#AA771C"/>
      </linearGradient>
      <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#241909"/>
        <stop offset="70%" stop-color="#120C04"/>
        <stop offset="100%" stop-color="#050301"/>
      </radialGradient>
      <filter id="medallionGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="glow"/>
        <feComposite in="SourceGraphic" in2="glow" operator="over"/>
      </filter>
    </defs>

    <!-- Outer Gold Ring -->
    <circle cx="${cx}" cy="${cy}" r="236" fill="url(#bgGlow)" stroke="url(#primaryGold)" stroke-width="5" filter="url(#medallionGlow)"/>

    <!-- Pearl Beaded Border -->
    ${Array.from({ length: 48 }).map((_, i) => {
      const angle = (i * 360) / 48;
      const rad = (angle * Math.PI) / 180;
      const bx = cx + 220 * Math.cos(rad);
      const by = cy + 220 * Math.sin(rad);
      return `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="3" fill="url(#primaryGold)"/>`;
    }).join('\n    ')}

    <!-- 8-Pointed Star Geometric Overlays (Rub El Hizb) -->
    <rect x="75" y="75" width="350" height="350" rx="20" fill="none" stroke="url(#primaryGold)" stroke-width="2" opacity="0.75"/>
    <rect x="75" y="75" width="350" height="350" rx="20" fill="none" stroke="url(#primaryGold)" stroke-width="2" opacity="0.75" transform="rotate(45 250 250)"/>

    <!-- Inner Golden Core -->
    <circle cx="${cx}" cy="${cy}" r="175" fill="#140E05" fill-opacity="0.9" stroke="url(#primaryGold)" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="165" fill="none" stroke="url(#primaryGold)" stroke-width="1" stroke-dasharray="5 3"/>

    <!-- Brand Name (Large Arabic Calligraphy) -->
    <text x="${cx}" y="240" text-anchor="middle" font-family="'Amiri', 'Scheherazade New', serif" font-weight="bold" font-size="46" fill="url(#primaryGold)" filter="url(#medallionGlow)">
      ${brand}
    </text>

    <!-- Subtitle / Tagline -->
    <text x="${cx}" y="300" text-anchor="middle" font-family="'Cairo', sans-serif" font-weight="600" font-size="17" fill="#FCF6BA" letter-spacing="3">
      ${sub}
    </text>

    <!-- Lower Flourish Accent -->
    <path d="M 195 330 Q 250 355 305 330 Q 250 340 195 330 Z" fill="url(#primaryGold)"/>
    <circle cx="${cx}" cy="345" r="3.5" fill="url(#primaryGold)"/>
  </svg>`;
}
