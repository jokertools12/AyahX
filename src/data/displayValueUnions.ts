/**
 * Canonical value unions for display settings.
 *
 * These are byte-identical to the zod enums in
 * `server/models/renderManifest.ts`. Keeping them in one place is what stops
 * the UI from offering a value the renderers reject (or hiding one they
 * support). Any change here must be mirrored in the manifest schema.
 */

export type HighlightStyle = 'none' | 'solid' | 'glow' | 'underline' | 'shadow';
export type GlowStyle = 'none' | 'golden' | 'soft' | 'neon' | 'pulse' | 'emerald' | 'royal';
export type TextShadowStyle = 'none' | 'soft' | 'strong' | '3d' | 'glow' | 'outline' | 'double';
export type AyahTransition =
  | 'none' | 'fade' | 'slide' | 'zoom' | 'blur'
  | 'rise' | 'rotate' | 'cinematic' | 'elastic' | 'random';
export type ReciterNameStyle =
  | 'simple' | 'elegant' | 'pill' | 'badge' | 'tag' | 'glow' | 'gold' | 'bordered';
export type SurahNameStyle =
  | 'classic' | 'goldenBadge' | 'banner' | 'calligraphy' | 'circle'
  | 'diamond' | 'ribbon' | 'modern' | 'ornate' | 'minimal';
export type SurahNamePosition = 'top' | 'center' | 'bottom' | 'topLeft' | 'topRight';
export type AyahNumberStyle =
  | 'quran3d' | 'circle' | 'star' | 'diamond' | 'octagon' | 'flower' | 'square' | 'hexagon';
export type AyahNumberColor =
  | 'gold' | 'metallicGold3D' | 'white' | 'silver' | 'emerald' | 'royal';
export type FrameStyle =
  | 'none' | 'simple' | 'ornate' | 'golden' | 'geometric' | 'modern' | 'minimal';
export type ScreenBorderStyle =
  | 'none' | 'goldenTrim' | 'islamicCorners' | 'doubleCinema' | 'royalCrest' | 'subtleVignette';
export type ScreenBorderColor = 'gold' | 'emerald' | 'silver' | 'white';
export type WatermarkPosition =
  | 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight' | 'bottomCenter';
export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'custom';
export type SocialWatermarkPosition = 'bottomCenter' | 'bottomRight' | 'bottomLeft' | 'topCenter';
export type LogoWatermarkPreset =
  | 'goldCalligraphy' | 'circularMedallion' | 'geometricEmblem' | 'glassMonogram' | 'custom';
export type LogoWatermarkPosition = 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';
export type LyricsDisplayStyle = 'scroll' | 'single' | 'karaoke' | 'fade';
export type SlideshowTransition =
  | 'crossfade' | 'slideLeft' | 'slideRight' | 'slideUp' | 'zoomThrough' | 'wipe' | 'mixed';
export type VisualDesign = 'dawn' | 'editorial' | 'moonlit';
