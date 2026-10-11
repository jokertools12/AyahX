import type { CatalogActor } from '../services/catalogAudit';
export const ADMIN_ROLES = ['super_admin', 'admin', 'content_manager', 'moderator', 'support', 'finance', 'analyst'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export const ADMIN_PERMISSIONS = {
  'render.test': 'اختبار الريندر الحقيقي: super_admin وadmin فقط',
  'dashboard.read': 'قراءة صحة النظام والمؤشرات',
  'reciters.read': 'قراءة القراء', 'reciters.write': 'تعديل بيانات وترتيب القراء',
  'reciters.visibility': 'إظهار وإخفاء القراء', 'reciters.merge': 'دمج القراء بخريطة صريحة',
  'recitations.read': 'قراءة التلاوات', 'recitations.write': 'تعديل بيانات وترتيب التلاوات',
  'recitations.visibility': 'تغيير الظهور العام للتلاوات', 'recitations.move': 'نقل تلاوة إلى قارئ آخر',
  'sources.read': 'قراءة المصادر وصحة الروابط', 'sources.write': 'تفعيل وتعطيل وفحص المصادر',
  'providers.read': 'قراءة المزوّدين والأدلة', 'providers.license.decide': 'قرار ترخيص المزوّد: super_admin فقط',
  'quran.read': 'قراءة النص القانوني وتكامله', 'quran.riwayah.write': 'تفعيل وتعطيل الروايات',
  'timings.read': 'قراءة التوقيتات ومدققاتها', 'review.read': 'قراءة المراجعات البشرية',
  'review.decide': 'قرار المراجعة البشرية', 'launch.manage': 'تغيير علم إطلاق الكتالوج',
  'storage.manage': 'إدارة التخزين المرخّص', 'settings.read': 'قراءة سجل الإعدادات',
  'settings.write': 'تعديل الإعدادات المسجّلة', 'flags.read': 'قراءة أعلام الميزات',
  'flags.write': 'تعديل أعلام الميزات', 'audit.read': 'قراءة وتصدير التدقيق',
  'roles.read': 'قراءة الأدوار والصلاحيات', 'roles.manage': 'تعديل الأدوار والصلاحيات: super_admin فقط',
  'users.read': 'قراءة قائمة المستخدمين والأدوار', 'security.self': 'إدارة جلساتي و2FA',
  'security.sessions.manage': 'إنهاء جلسات الأدمن الأخرى: super_admin فقط',
} as const;
export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;
const base: AdminPermission[] = ['dashboard.read', 'security.self'];
const read: AdminPermission[] = ['reciters.read', 'recitations.read', 'sources.read', 'providers.read', 'quran.read', 'timings.read', 'review.read', 'audit.read'];
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  super_admin: Object.keys(ADMIN_PERMISSIONS) as AdminPermission[],
  admin: (Object.keys(ADMIN_PERMISSIONS) as AdminPermission[]).filter(p => !['roles.manage', 'providers.license.decide', 'security.sessions.manage'].includes(p)),
  content_manager: [...base, ...read, 'reciters.write', 'reciters.visibility', 'reciters.merge', 'recitations.write', 'recitations.visibility', 'recitations.move', 'sources.write', 'quran.riwayah.write', 'review.decide'],
  moderator: [...base, 'reciters.read', 'recitations.read', 'review.read', 'audit.read'],
  support: [...base, 'users.read', 'reciters.read', 'recitations.read', 'review.read'],
  finance: [...base, 'users.read', 'audit.read'],
  analyst: [...base, ...read, 'users.read', 'settings.read', 'flags.read', 'roles.read'],
};
/** Explicit service grants adapt the older service vocabulary; never a role bypass. */
const ALIASES: Partial<Record<AdminPermission, readonly string[]>> = {
  'reciters.merge': ['recitations.move'],
  'recitations.write': ['recitations.manage'], 'recitations.visibility': ['recitations.manage'],
  'sources.write': ['recitations.sources.manage', 'catalog.links.check'],
  'review.read': ['reviews.read'], 'review.decide': ['reviews.decide', 'recitations.voice.review'],
  'settings.write': ['settings.catalog.manage'],
  'providers.license.decide': ['providers.license.review'],
  'storage.manage': ['storage.verify', 'storage.preview'],
};
export function isAdminRole(value: unknown): value is AdminRole { return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole); }
export function isAdminPermission(value: unknown): value is AdminPermission { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ADMIN_PERMISSIONS, value); }
export function servicePermissions(permissions: readonly string[], roles: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of permissions) {
    if (!isAdminPermission(value)) throw new Error('ADMIN_PERMISSION_UNDEFINED');
    result.add(value);
    if (value === 'providers.license.decide' && !roles.includes('super_admin')) continue;
    for (const alias of ALIASES[value] ?? []) result.add(alias);
  }
  return result;
}
export function actorWithContext(actor: CatalogActor, requestId: string, ipAddress: string): CatalogActor { return { ...actor, requestId, ipAddress }; }
