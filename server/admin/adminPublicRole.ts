/** Existing public owner checks retain their meaning after the admin upgrade. */
export function publicRole(roles: readonly string[]): 'admin' | 'moderator' | 'user' {
  if (roles.includes('super_admin') || roles.includes('admin')) return 'admin';
  return roles.includes('moderator') ? 'moderator' : 'user';
}
