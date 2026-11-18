/**
 * Suite de verificação contratual dos payloads maliciosos ("Dirty Dozen") descritos em security_spec.md.
 * Projetada para validar as invariantes de regras do Firestore para /admins, /users e /recovery.
 */
export interface DirtyPayloadCase {
  name: string;
  actor: 'anonymous' | 'spoofed_email' | 'user' | 'admin';
  collection: 'admins' | 'users' | 'recovery';
  op: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_CASES: DirtyPayloadCase[] = [
  { name: 'Unauthenticated user read', actor: 'anonymous', collection: 'users', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Spoofed unverified admin email', actor: 'spoofed_email', collection: 'admins', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Self-privilege admin escalation', actor: 'user', collection: 'admins', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'User altering own permissions', actor: 'user', collection: 'users', op: 'update', expected: 'PERMISSION_DENIED', payload: { permAlteracao: true } },
  { name: 'Cross-user read', actor: 'user', collection: 'users', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow ghost field injection', actor: 'admin', collection: 'users', op: 'create', expected: 'PERMISSION_DENIED', payload: { ghostField: true } },
  { name: 'Oversized path ID', actor: 'admin', collection: 'users', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Invalid boolean type on mustChangePassword', actor: 'user', collection: 'users', op: 'update', expected: 'PERMISSION_DENIED', payload: { mustChangePassword: 'false' } },
  { name: 'Immutable createdAt tampering', actor: 'admin', collection: 'users', op: 'update', expected: 'PERMISSION_DENIED', payload: { createdAt: '2020-01-01T00:00:00Z' } },
  { name: 'Client timestamp forgery on recovery', actor: 'user', collection: 'recovery', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Recovery collection list scraping', actor: 'anonymous', collection: 'recovery', op: 'list', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user recovery hijack', actor: 'user', collection: 'recovery', op: 'create', expected: 'PERMISSION_DENIED', payload: { uid: 'other-user-uid' } },
];
