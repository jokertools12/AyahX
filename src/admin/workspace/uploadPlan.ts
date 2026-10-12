export const MAX_UPLOAD_BATCH = 114;
export const MAX_AUDIO_BYTES = 1_000_000_000;
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'] as const;

export interface AudioFileInput { name: string; size: number }
export interface PlannedAudioFile<T extends AudioFileInput> { file: T; surah: number; extension: string }
export interface UploadPlan<T extends AudioFileInput> {
  files: PlannedAudioFile<T>[];
  rejected: Array<{ name: string; reason: 'BATCH_LIMIT' | 'INVALID_CHAPTER_NAME' | 'UNSUPPORTED_AUDIO' | 'INVALID_SIZE' | 'DUPLICATE_CHAPTER' }>;
  missing: number[];
}

/** Names are an explicit owner-supplied chapter mapping, never a guessed recording identity. */
export function planAudioBatch<T extends AudioFileInput>(files: readonly T[]): UploadPlan<T> {
  const result: UploadPlan<T> = { files: [], rejected: [], missing: [] };
  const used = new Set<number>();
  const duplicates = new Set<number>();
  for (const [index, file] of files.entries()) {
    const reject = (reason: UploadPlan<T>['rejected'][number]['reason']) => result.rejected.push({ name: file.name, reason });
    if (index >= MAX_UPLOAD_BATCH) { reject('BATCH_LIMIT'); continue; }
    const match = /^([0-9]{1,3})\.([a-z0-9]+)$/iu.exec(file.name);
    const surah = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(surah) || surah < 1 || surah > 114) { reject('INVALID_CHAPTER_NAME'); continue; }
    const extension = match[2].toLowerCase();
    if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension)) { reject('UNSUPPORTED_AUDIO'); continue; }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_AUDIO_BYTES) { reject('INVALID_SIZE'); continue; }
    if (used.has(surah)) { duplicates.add(surah); reject('DUPLICATE_CHAPTER'); continue; }
    used.add(surah);
    result.files.push({ file, surah, extension });
  }
  result.files = result.files.filter(row => {
    if (!duplicates.has(row.surah)) return true;
    result.rejected.push({ name: row.file.name, reason: 'DUPLICATE_CHAPTER' });
    used.delete(row.surah);
    return false;
  });
  result.missing = Array.from({ length: 114 }, (_, index) => index + 1).filter(surah => !used.has(surah));
  return result;
}

export function formatBytes(bytes: number, language: 'ar' | 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return language === 'ar' ? 'غير متاح' : 'Unavailable';
  const unit = bytes >= 1_000_000_000 ? 'GB' : bytes >= 1_000_000 ? 'MB' : bytes >= 1_000 ? 'KB' : 'B';
  const divisor = unit === 'GB' ? 1_000_000_000 : unit === 'MB' ? 1_000_000 : unit === 'KB' ? 1_000 : 1;
  return `${(bytes / divisor).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })} ${unit}`;
}
