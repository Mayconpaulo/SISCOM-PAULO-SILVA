/**
 * Suite de verificação contratual dos payloads maliciosos ("Dirty Dozen") descritos em security_spec.md.
 * Projetada para validar as invariantes de regras do Firestore para /admins, /users e /recovery.
 */
export interface DirtyPayloadCase {
  name: string;
  actor: 'anonymous' | 'spoofed_email' | 'user' | 'admin';
  collection: 'admins' | 'users' | 'recovery' | 'alteracao_folders' | 'alteracao_docs';
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
  { name: 'Deactivated admin account lockout', actor: 'admin', collection: 'users', op: 'update', expected: 'PERMISSION_DENIED', payload: { active: false } },
  { name: 'Secondary admin tampering with root or unlinked admin', actor: 'admin', collection: 'admins', op: 'delete', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user alteracao folder read', actor: 'user', collection: 'alteracao_folders', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Folder self-parent cycle injection', actor: 'user', collection: 'alteracao_folders', op: 'create', expected: 'PERMISSION_DENIED', payload: { id: 'f1', parentId: 'f1' } },
  { name: 'Cross-user alteracao doc write', actor: 'user', collection: 'alteracao_docs', op: 'create', expected: 'PERMISSION_DENIED', payload: { ownerUid: 'other-user-uid' } },
  { name: 'Alteracao doc empty pagesHtml payload', actor: 'user', collection: 'alteracao_docs', op: 'create', expected: 'PERMISSION_DENIED', payload: { pagesHtml: [] } },
];
