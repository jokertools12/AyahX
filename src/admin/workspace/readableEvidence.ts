import { evidenceFieldLabels, termLabel, terms, type AdminLocale } from '../i18n/terms';

export interface EvidenceFact { field: string; label: string; value: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const enumFields = new Set(['voice_identity_status', 'audio_status', 'verification_status', 'basmala_mode', 'license_status', 'rights_status', 'style']);
const numberFields = new Set(['surah', 'observed_count', 'missing_words', 'coverage_words', 'expected_words']);

/** A bounded projection for the owner. Arbitrary keys and diagnostic payloads stay in the technical disclosure. */
export function readableEvidence(value: unknown, locale: AdminLocale): EvidenceFact[] {
  const facts: EvidenceFact[] = [], seen = new Set<string>();
  const add = (field: string, fact: string) => {
    const label = evidenceFieldLabels[field]?.[locale];
    if (!label || seen.has(field)) return;
    seen.add(field); facts.push({ field, label, value: fact });
  };
  const walk = (current: unknown, depth: number) => {
    if (!record(current) || depth > 5) return;
    for (const [field, child] of Object.entries(current)) {
      if (enumFields.has(field) && typeof child === 'string') add(field, termLabel(child, locale));
      else if (numberFields.has(field) && typeof child === 'number' && Number.isFinite(child)) add(field, child.toLocaleString(locale));
      else if (field === 'offset_verified' && typeof child === 'boolean') add(field, termLabel(child ? 'passed' : 'unverified', locale));
      else if (['catalog_label', 'display_label_ar'].includes(field) && typeof child === 'string' && child.trim()) add(field, child.slice(0, 255));
      else if (['V1', 'V2', 'V3', 'V4'].includes(field) && record(child)) add(field, termLabel(child.passed === true ? 'passed' : child.passed === false ? 'failed' : 'unverified', locale));
      else if (record(child)) walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return facts;
}

export function readableCode(value: unknown, locale: AdminLocale): string {
  if (typeof value !== 'string' || !value) return locale === 'ar' ? 'غير متاح' : 'Unavailable';
  return terms[value] ? termLabel(value, locale) : locale === 'ar' ? 'سبب تقني يحتاج مراجعة التفاصيل' : 'Technical reason; review the details';
}
