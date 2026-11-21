import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  ModuleKey,
  MODULE_PERM_FIELD,
  UserAccount,
  ensureBootstrappedAdminProfile,
  isBootstrappedGoogleUser,
} from './authService';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
} from './firebase';

interface AuthContextValue {
  firebaseUser: User | null;
  account: UserAccount | null;
  managedUsers: UserAccount[];
  booting: boolean;
  loadingProfile: boolean;
  unauthorizedReason: string | null;
  hasModuleAccess: (moduleKey: ModuleKey) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  account: null,
  managedUsers: [],
  booting: true,
  loadingProfile: false,
  unauthorizedReason: null,
  hasModuleAccess: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [managedUsers, setManagedUsers] = useState<UserAccount[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [initialBootDone, setInitialBootDone] = useState(false);
  const [unauthorizedReason, setUnauthorizedReason] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setUnauthorizedReason(null);

      if (!user) {
        setAccount(null);
        setManagedUsers([]);
        setProfileLoaded(true);
        setAuthReady(true);
        return;
      }

      setProfileLoaded(false);
      setAuthReady(true);

      if (isBootstrappedGoogleUser(user)) {
        try {
          await ensureBootstrappedAdminProfile(user);
        } catch (err) {
          console.error('Failed to bootstrap admin profile:', err);
        }
      }
    });

    return () => unsub();
  }, []);

  // Mark initial page boot complete once the first auth + profile check settles
  useEffect(() => {
    if (!initialBootDone && authReady && (!firebaseUser || profileLoaded)) {
      setInitialBootDone(true);
    }
  }, [initialBootDone, authReady, firebaseUser, profileLoaded]);

  // Real-time listener on the logged-in user's own profile & permissions
  useEffect(() => {
    if (!firebaseUser) return;

    const userDocPath = `users/${firebaseUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (!snap.exists()) {
          setAccount(null);
          setUnauthorizedReason(
            isBootstrappedGoogleUser(firebaseUser)
              ? null
              : 'Conta sem cadastro ativo. Solicite acesso ao administrador.'
          );
          setProfileLoaded(true);
          return;
        }
        const data = snap.data() as UserAccount;
        if (!data.active) {
          setAccount(data);
          setUnauthorizedReason('Seu acesso foi desativado pelo administrador.');
        } else {
          setAccount(data);
          setUnauthorizedReason(null);
        }
        setProfileLoaded(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, userDocPath);
      }
    );

    return () => unsub();
  }, [firebaseUser]);

  // Real-time listener for all managed users when signed in as Admin
  useEffect(() => {
    if (!firebaseUser || account?.role !== 'admin') {
      setManagedUsers([]);
      return;
    }

    const usersQuery = isBootstrappedGoogleUser(firebaseUser)
      ? collection(db, 'users')
      : query(
          collection(db, 'users'),
          where('adminUids', 'array-contains', firebaseUser.uid)
        );

    const unsub = onSnapshot(
      usersQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as UserAccount)
          .sort((a, b) => {
            if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
            return a.username.localeCompare(b.username);
          });
        setManagedUsers(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );

    return () => unsub();
  }, [firebaseUser, account?.role]);

  const hasModuleAccess = (moduleKey: ModuleKey): boolean => {
    if (!account || !account.active) return false;
    const field = MODULE_PERM_FIELD[moduleKey];
    if (account[field] === undefined) {
      return moduleKey === 'relatorio' || moduleKey === 'arquivo' || account.role === 'admin';
    }
    return Boolean(account[field]);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        account,
        managedUsers,
        booting: !initialBootDone,
        loadingProfile: Boolean(firebaseUser) && !profileLoaded,
        unauthorizedReason,
        hasModuleAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
