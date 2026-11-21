import {
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  OperationType,
  auth,
  db,
  getSecondaryAuth,
  handleFirestoreError,
} from './firebase';
import {
  decryptPasswordWithAnswer,
  encryptPasswordWithAnswer,
} from './recoveryCrypto';
import { purgeAllSensitiveLocalData } from '../privacy/privacyVault';
import { disconnectGoogleCalendarSession } from '../../modules/agenda/googleCalendarService';

export type ModuleKey =
  | 'prismas'
  | 'crachas'
  | 'alteracao'
  | 'documentos'
  | 'cartoes'
  | 'relatorio'
  | 'agenda'
  | 'arquivo';

export interface ModulePermissions {
  permPrismas: boolean;
  permCrachas: boolean;
  permAlteracao: boolean;
  permDocumentos: boolean;
  permCartoes: boolean;
  permRelatorio?: boolean;
  permAgenda?: boolean;
  permArquivo?: boolean;
}

export interface UserAccount extends ModulePermissions {
  uid: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  active: boolean;
  emailVerified: boolean;
  mustChangePassword?: boolean;
  securityQuestionSetup?: boolean;
  adminUids: string[];
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface RecoveryRecord {
  uid: string;
  username: string;
  question: string;
  salt: string;
  iv: string;
  encryptedPassword: string;
}

export const MODULE_PERM_FIELD: Record<ModuleKey, keyof ModulePermissions> = {
  prismas: 'permPrismas',
  crachas: 'permCrachas',
  alteracao: 'permAlteracao',
  documentos: 'permDocumentos',
  cartoes: 'permCartoes',
  relatorio: 'permRelatorio',
  agenda: 'permAgenda',
  arquivo: 'permArquivo',
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  prismas: 'Prismas',
  crachas: 'Crachás',
  alteracao: 'Alterações',
  documentos: 'Documentos',
  cartoes: 'Cartões',
  relatorio: 'Relatório',
  agenda: 'Agenda',
  arquivo: 'Arquivo',
};

export const ALL_MODULE_KEYS: ModuleKey[] = [
  'prismas',
  'crachas',
  'alteracao',
  'documentos',
  'cartoes',
  'relatorio',
  'agenda',
  'arquivo',
];

export const SYNTHETIC_DOMAIN = 'siscom.app';
const USERNAME_REGEX = /^[a-z0-9._-]{2,40}$/;

export function normalizeUsername(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
}

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

export function sanitizeDisplayName(raw: string, fallback: string): string {
  const cleaned = raw.trim().slice(0, 80);
  return cleaned || fallback.slice(0, 80) || 'Usuário';
}

export function usernameToAuthEmail(usernameOrEmail: string): string {
  const trimmed = usernameOrEmail.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${normalizeUsername(trimmed)}@${SYNTHETIC_DOMAIN}`;
}

function makeUniqueAuthEmail(cleanUser: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const prefix = `${cleanUser}.${suffix}`.replace(/\.{2,}/g, '.').slice(0, 100);
  return `${prefix}@${SYNTHETIC_DOMAIN}`;
}

export async function resolveAuthEmailForUsername(usernameOrEmail: string): Promise<string> {
  const trimmed = usernameOrEmail.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;

  const cleanUser = normalizeUsername(trimmed);
  if (!isValidUsername(cleanUser)) {
    return `${cleanUser || 'invalid'}@${SYNTHETIC_DOMAIN}`;
  }

  try {
    const snap = await getDoc(doc(db, 'auth_lookup', cleanUser));
    if (snap.exists()) {
      const authEmail = snap.data()?.authEmail;
      if (typeof authEmail === 'string' && authEmail.includes('@')) {
        return authEmail;
      }
    }
  } catch {
    // Fallback to legacy format
  }

  return `${cleanUser}@${SYNTHETIC_DOMAIN}`;
}

export function isBootstrappedGoogleUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email &&
      user.email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL
  );
}

export function isFirebaseAuthOperationNotAllowed(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  return (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/admin-restricted-operation'
  );
}

export function formatAuthErrorPtBr(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Usuário ou senha incorretos.';
    case 'auth/invalid-email':
      return 'Informe um usuário válido.';
    case 'auth/email-already-in-use':
      return 'Este usuário já está em uso por outra conta.';
    case 'auth/weak-password':
      return 'A senha deve ter pelo menos 6 caracteres.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas seguidas. Aguarde alguns segundos.';
    case 'auth/popup-closed-by-user':
      return 'Janela de login fechada.';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Ative o provedor E-mail/senha no Console do Firebase para usar login por usuário e senha.';
    case 'auth/requires-recent-login':
      return 'Sessão expirada para esta operação. Saia e entre novamente para continuar.';
    default:
      return error instanceof Error ? error.message : 'Erro ao autenticar.';
  }
}

export async function signInWithUsernameOrEmail(
  usernameOrEmail: string,
  password: string
): Promise<User> {
  const email = await resolveAuthEmailForUsername(usernameOrEmail);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithGoogleAdmin(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOutCurrentUser(): Promise<void> {
  purgeAllSensitiveLocalData();
  await disconnectGoogleCalendarSession();
  await signOut(auth);
}

export async function reauthenticateActiveUser(password?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sessão encerrada. Faça login novamente.');
  }

  const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  if (isGoogle && !user.email?.endsWith(`@${SYNTHETIC_DOMAIN}`)) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await reauthenticateWithPopup(user, provider);
    return;
  }

  if (!user.email) {
    throw new Error('Identificador da conta ausente.');
  }
  if (!password || password.length < 1) {
    throw new Error('Digite sua senha atual para desbloquear.');
  }

  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
}

export async function ensureBootstrappedAdminProfile(user: User): Promise<void> {
  if (!isBootstrappedGoogleUser(user)) return;

  const adminPath = `admins/${user.uid}`;
  const userPath = `users/${user.uid}`;

  try {
    const adminRef = doc(db, 'admins', user.uid);
    const adminSnap = await getDoc(adminRef);
    if (!adminSnap.exists()) {
      await setDoc(adminRef, {
        uid: user.uid,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, adminPath);
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      const displayName = sanitizeDisplayName(user.displayName || '', 'Administrador');
      await setDoc(userRef, {
        uid: user.uid,
        username: 'admin-google',
        displayName,
        role: 'admin',
        active: true,
        emailVerified: true,
        mustChangePassword: false,
        securityQuestionSetup: true,
        permPrismas: true,
        permCrachas: true,
        permAlteracao: true,
        permDocumentos: true,
        permCartoes: true,
        permRelatorio: true,
        permAgenda: true,
        permArquivo: true,
        adminUids: [user.uid],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (
      userSnap.data()?.emailVerified !== true ||
      userSnap.data()?.permRelatorio === undefined ||
      userSnap.data()?.permAgenda === undefined ||
      userSnap.data()?.permArquivo === undefined
    ) {
      await updateDoc(userRef, {
        emailVerified: true,
        mustChangePassword: false,
        securityQuestionSetup: true,
        ...(userSnap.data()?.permRelatorio === undefined ? { permRelatorio: true } : {}),
        ...(userSnap.data()?.permAgenda === undefined ? { permAgenda: true } : {}),
        ...(userSnap.data()?.permArquivo === undefined ? { permArquivo: true } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

async function assertUsernameAvailable(cleanUser: string, adminUser: User): Promise<void> {
  const existingLookup = await getDoc(doc(db, 'auth_lookup', cleanUser));
  if (existingLookup.exists()) {
    throw new Error('Este usuário já está em uso por outra conta ativa.');
  }

  const usersCheckQuery = isBootstrappedGoogleUser(adminUser)
    ? query(collection(db, 'users'), where('username', '==', cleanUser))
    : query(collection(db, 'users'), where('adminUids', 'array-contains', adminUser.uid));
  const usersCheckSnap = await getDocs(usersCheckQuery);
  if (usersCheckSnap.docs.some((d) => d.data()?.username === cleanUser)) {
    throw new Error('Este usuário já está em uso por outra conta ativa.');
  }
}

export async function createManagedUserAccount(params: {
  adminUser: User;
  adminAccount: UserAccount;
  username: string;
  displayName: string;
  password: string;
  role: 'admin' | 'user';
  permissions: ModulePermissions;
  requireFirstLoginSetup?: boolean;
}): Promise<UserAccount> {
  const cleanUser = normalizeUsername(params.username);
  if (!isValidUsername(cleanUser)) {
    throw new Error('Usuário inválido. Use 2 a 40 caracteres (letras, números, . _ -).');
  }
  if (params.password.length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }

  await assertUsernameAvailable(cleanUser, params.adminUser);

  const displayName = sanitizeDisplayName(params.displayName, cleanUser);
  const email = makeUniqueAuthEmail(cleanUser);
  const requireSetup = params.requireFirstLoginSetup !== false;

  const secondaryAuth = getSecondaryAuth();
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, params.password);
  const newUid = cred.user.uid;
  await signOut(secondaryAuth);

  const baseAdminUids = Array.from(
    new Set([params.adminUser.uid, ...(params.adminAccount.adminUids || [])])
  );
  if (params.role === 'admin' && !baseAdminUids.includes(newUid)) {
    baseAdminUids.push(newUid);
  }
  const boundedAdminUids = baseAdminUids.slice(0, 10);

  if (params.role === 'admin') {
    const adminPath = `admins/${newUid}`;
    try {
      await setDoc(doc(db, 'admins', newUid), {
        uid: newUid,
        createdBy: params.adminUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, adminPath);
    }
  }

  const payload = {
    uid: newUid,
    username: cleanUser,
    displayName,
    role: params.role,
    active: true,
    emailVerified: false,
    mustChangePassword: requireSetup,
    securityQuestionSetup: !requireSetup,
    permPrismas: Boolean(params.permissions.permPrismas),
    permCrachas: Boolean(params.permissions.permCrachas),
    permAlteracao: Boolean(params.permissions.permAlteracao),
    permDocumentos: Boolean(params.permissions.permDocumentos),
    permCartoes: Boolean(params.permissions.permCartoes),
    permRelatorio: Boolean(params.permissions.permRelatorio),
    permAgenda: Boolean(params.permissions.permAgenda),
    permArquivo: Boolean(params.permissions.permArquivo),
    adminUids: boundedAdminUids,
    createdBy: params.adminUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const userPath = `users/${newUid}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', newUid), payload);
    batch.set(doc(db, 'auth_lookup', cleanUser), {
      uid: newUid,
      username: cleanUser,
      authEmail: email,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  // Ensure any stale recovery question from an earlier deleted account is cleared
  try {
    await deleteDoc(doc(db, 'recovery', cleanUser));
  } catch {
    // Non-fatal
  }

  if (params.role === 'admin') {
    await propagateAdminUidToManagedUsers(params.adminUser.uid, newUid);
  }

  return {
    ...payload,
    createdAt: undefined,
    updatedAt: undefined,
  };
}

export async function completeFirstLoginPasswordChange(params: {
  user: User;
  newPassword: string;
}): Promise<void> {
  if (params.newPassword.length < 6) {
    throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  }

  await updatePassword(params.user, params.newPassword);

  const path = `users/${params.user.uid}`;
  try {
    await updateDoc(doc(db, 'users', params.user.uid), {
      mustChangePassword: false,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function saveSecurityQuestionAndPassword(params: {
  user: User;
  account: UserAccount;
  question: string;
  answer: string;
  currentPassword: string;
}): Promise<void> {
  const cleanQuestion = params.question.trim().slice(0, 160);
  if (cleanQuestion.length < 3) {
    throw new Error('A pergunta de segurança deve ter pelo menos 3 caracteres.');
  }
  if (params.answer.trim().length < 1) {
    throw new Error('Digite uma resposta para a pergunta de segurança.');
  }
  if (params.currentPassword.length < 6) {
    throw new Error('Informe sua senha atual (mín. 6 caracteres) para confirmar.');
  }
  if (!params.user.email) {
    throw new Error('Conta sem identificador de login válido.');
  }

  // Reauthenticate to verify 100% that the password being sealed matches Firebase Auth
  const credential = EmailAuthProvider.credential(params.user.email, params.currentPassword);
  await reauthenticateWithCredential(params.user, credential);

  const encrypted = await encryptPasswordWithAnswer(params.currentPassword, params.answer);

  const batch = writeBatch(db);
  batch.set(doc(db, 'recovery', params.account.username), {
    uid: params.user.uid,
    username: params.account.username,
    question: cleanQuestion,
    salt: encrypted.salt,
    iv: encrypted.iv,
    encryptedPassword: encrypted.encryptedPassword,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', params.user.uid), {
    mustChangePassword: false,
    securityQuestionSetup: true,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `recovery/${params.account.username}`);
  }
}

export async function fetchRecoveryQuestionByUsername(
  usernameOrWarName: string
): Promise<RecoveryRecord> {
  const cleanUser = normalizeUsername(usernameOrWarName);
  if (!isValidUsername(cleanUser)) {
    throw new Error('Informe um Nome de guerra ou Usuário válido.');
  }

  const path = `recovery/${cleanUser}`;
  try {
    const snap = await getDoc(doc(db, 'recovery', cleanUser));
    if (!snap.exists()) {
      throw new Error(
        'Nenhuma pergunta de segurança encontrada para este usuário. Se for seu primeiro acesso, entre com a senha informada pelo administrador.'
      );
    }
    return snap.data() as RecoveryRecord;
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function verifySecurityAnswerForRecord(
  record: RecoveryRecord,
  answer: string
): Promise<string> {
  return decryptPasswordWithAnswer(record, answer);
}

export async function resetForgottenPasswordWithSecurityAnswer(params: {
  record: RecoveryRecord;
  answer: string;
  newPassword: string;
}): Promise<void> {
  if (params.newPassword.length < 6) {
    throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  }

  const oldPassword = await decryptPasswordWithAnswer(params.record, params.answer);
  const email = await resolveAuthEmailForUsername(params.record.username);
  const cred = await signInWithEmailAndPassword(auth, email, oldPassword);

  await updatePassword(cred.user, params.newPassword);

  const reEncrypted = await encryptPasswordWithAnswer(params.newPassword, params.answer);

  const batch = writeBatch(db);
  batch.set(doc(db, 'recovery', params.record.username), {
    uid: cred.user.uid,
    username: params.record.username,
    question: params.record.question,
    salt: reEncrypted.salt,
    iv: reEncrypted.iv,
    encryptedPassword: reEncrypted.encryptedPassword,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', cred.user.uid), {
    mustChangePassword: false,
    securityQuestionSetup: true,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `recovery/${params.record.username}`);
  }
}

async function propagateAdminUidToManagedUsers(
  currentAdminUid: string,
  addedAdminUid: string,
  removeAdminUid?: string
): Promise<void> {
  try {
    const q = isBootstrappedGoogleUser(auth.currentUser)
      ? collection(db, 'users')
      : query(collection(db, 'users'), where('adminUids', 'array-contains', currentAdminUid));
    const snap = await getDocs(q);
    await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data() as Partial<UserAccount>;
        const nextList = Array.from(
          new Set(
            [...(data.adminUids || []), addedAdminUid].filter(
              (id) => id && id !== removeAdminUid
            )
          )
        ).slice(0, 10);
        await updateDoc(doc(db, 'users', d.id), {
          emailVerified: Boolean(data.emailVerified),
          adminUids: nextList,
          updatedAt: serverTimestamp(),
        });
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'users');
  }
}

export async function toggleUserModulePermission(
  targetUser: UserAccount,
  moduleKey: ModuleKey,
  enabled: boolean
): Promise<void> {
  const permField = MODULE_PERM_FIELD[moduleKey];
  const path = `users/${targetUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', targetUser.uid), {
      [permField]: enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleUserActiveStatus(
  targetUser: UserAccount,
  active: boolean
): Promise<void> {
  const path = `users/${targetUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', targetUser.uid), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeManagedUser(targetUser: UserAccount): Promise<void> {
  if (auth.currentUser?.uid === targetUser.uid) {
    throw new Error('Você não pode excluir o próprio login conectado.');
  }
  try {
    if (targetUser.role === 'admin') {
      await deleteDoc(doc(db, 'admins', targetUser.uid));
    }
    await deleteDoc(doc(db, 'users', targetUser.uid));
    try {
      await deleteDoc(doc(db, 'auth_lookup', targetUser.username));
    } catch {
      // Auth lookup may not exist for legacy users
    }
    try {
      await deleteDoc(doc(db, 'recovery', targetUser.username));
    } catch {
      // Recovery record may not exist yet
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${targetUser.uid}`);
  }
}

export async function updateOwnAdminProfile(params: {
  currentUser: User;
  currentAccount: UserAccount;
  newUsername: string;
  newDisplayName: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ mode: 'updated' | 'created_secondary' | 'migrated_username'; username: string }> {
  const cleanNewUser = normalizeUsername(params.newUsername);
  if (!isValidUsername(cleanNewUser)) {
    throw new Error('Usuário inválido. Use 2 a 40 caracteres (letras minúsculas, números, . _ -).');
  }

  const displayName = sanitizeDisplayName(params.newDisplayName, cleanNewUser);
  const isGoogleSession = params.currentUser.providerData.some(
    (p) => p.providerId === 'google.com'
  );

  if (isGoogleSession && !params.currentUser.email?.endsWith(`@${SYNTHETIC_DOMAIN}`)) {
    if (params.newPassword.length < 6) {
      throw new Error('Informe uma senha com pelo menos 6 caracteres para o login de administrador.');
    }

    await createManagedUserAccount({
      adminUser: params.currentUser,
      adminAccount: params.currentAccount,
      username: cleanNewUser,
      displayName,
      password: params.newPassword,
      role: 'admin',
      requireFirstLoginSetup: false,
      permissions: {
        permPrismas: true,
        permCrachas: true,
        permAlteracao: true,
        permDocumentos: true,
        permCartoes: true,
        permRelatorio: true,
        permAgenda: true,
        permArquivo: true,
      },
    });

    if (displayName !== params.currentAccount.displayName) {
      await updateDoc(doc(db, 'users', params.currentUser.uid), {
        displayName,
        emailVerified: true,
        updatedAt: serverTimestamp(),
      });
    }

    return { mode: 'created_secondary', username: cleanNewUser };
  }

  const hasVerifiedRealEmail = Boolean(
    params.currentUser.emailVerified &&
      params.currentUser.email &&
      !params.currentUser.email.toLowerCase().endsWith(`@${SYNTHETIC_DOMAIN}`)
  );

  const usernameChanged = cleanNewUser !== params.currentAccount.username;
  const passwordChanged = params.newPassword.length > 0;

  if (passwordChanged && params.newPassword.length < 6) {
    throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  }

  if ((passwordChanged || (usernameChanged && !hasVerifiedRealEmail)) && !params.currentPassword) {
    throw new Error('Informe a senha atual para alterar login ou senha.');
  }

  if (passwordChanged || (usernameChanged && !hasVerifiedRealEmail)) {
    if (!params.currentUser.email) {
      throw new Error('E-mail interno de autenticação ausente.');
    }
    const credential = EmailAuthProvider.credential(
      params.currentUser.email,
      params.currentPassword
    );
    await reauthenticateWithCredential(params.currentUser, credential);
  }

  if (!usernameChanged || hasVerifiedRealEmail) {
    if (passwordChanged) {
      await updatePassword(params.currentUser, params.newPassword);
      try {
        await deleteDoc(doc(db, 'recovery', cleanNewUser));
      } catch {
        // Ignore if not set
      }
    }
    if (usernameChanged || displayName !== params.currentAccount.displayName) {
      try {
        await updateDoc(doc(db, 'users', params.currentUser.uid), {
          username: cleanNewUser,
          displayName,
          emailVerified: hasVerifiedRealEmail,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${params.currentUser.uid}`);
      }
    }
    return { mode: 'updated', username: cleanNewUser };
  }

  await assertUsernameAvailable(cleanNewUser, params.currentUser);

  const oldUid = params.currentUser.uid;
  const oldUsername = params.currentAccount.username;
  const effectivePassword = params.newPassword || params.currentPassword;
  const newEmail = makeUniqueAuthEmail(cleanNewUser);
  const secondaryAuth = getSecondaryAuth();
  const newCred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, effectivePassword);
  const newUid = newCred.user.uid;
  await signOut(secondaryAuth);

  const nextAdminUids = Array.from(
    new Set([
      ...(params.currentAccount.adminUids || []).filter((id) => id !== oldUid),
      newUid,
    ])
  ).slice(0, 10);

  try {
    await setDoc(doc(db, 'admins', newUid), {
      uid: newUid,
      createdBy: oldUid,
      createdAt: serverTimestamp(),
    });
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', newUid), {
      uid: newUid,
      username: cleanNewUser,
      displayName,
      role: 'admin',
      active: true,
      emailVerified: false,
      mustChangePassword: false,
      securityQuestionSetup: false,
      permPrismas: true,
      permCrachas: true,
      permAlteracao: true,
      permDocumentos: true,
      permCartoes: true,
      permRelatorio: true,
      permAgenda: true,
      permArquivo: true,
      adminUids: nextAdminUids,
      createdBy: oldUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'auth_lookup', cleanNewUser), {
      uid: newUid,
      username: cleanNewUser,
      authEmail: newEmail,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${newUid}`);
  }

  await propagateAdminUidToManagedUsers(oldUid, newUid, oldUid);
  await signInWithEmailAndPassword(auth, newEmail, effectivePassword);

  try {
    await deleteDoc(doc(db, 'admins', oldUid));
    await deleteDoc(doc(db, 'users', oldUid));
    await deleteDoc(doc(db, 'auth_lookup', oldUsername));
    await deleteDoc(doc(db, 'recovery', oldUsername));
  } catch {
    // Non-fatal cleanup
  }

  return { mode: 'migrated_username', username: cleanNewUser };
}
