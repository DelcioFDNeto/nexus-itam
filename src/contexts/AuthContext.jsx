// src/contexts/AuthContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { auth, db, isFirebaseConfigured } from '../services/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { MASTER_TENANT } from '../utils/permissions';
import { isTenantBlocked, isUserBlocked, resolveEntitlements } from '../utils/entitlements';
import { safeCssColor, safeImageUrl } from '../utils/sanitize';
import { buildInitialSettings, newTenantId } from '../services/tenantService';
import {
  clearGatewaySession,
  getGatewaySession,
  microservicesApi,
  onGatewaySessionChange,
  setGatewaySession,
} from '../services/microservicesClient';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

// Registra o ultimo acesso no maximo uma vez por hora: o console master usa o
// campo para apontar empresas inativas sem precisar varrer o historico.
const LAST_LOGIN_THROTTLE_MS = 60 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const touchLastLogin = (uid, profile) => {
  if (!isFirebaseConfigured) return;
  const last = toDate(profile?.lastLoginAt);
  if (last && Date.now() - last.getTime() < LAST_LOGIN_THROTTLE_MS) return;
  updateDoc(doc(db, 'users', uid), { lastLoginAt: serverTimestamp() }).catch(() => {
    /* perfil so em custom claims ou sem permissao: apenas nao registra */
  });
};

const readDoc = async (path) => {
  try {
    const snap = await getDoc(doc(db, ...path));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
};

const tenantHintKey = (uid) => `nexus:tenant-hint:${uid}`;
const readTenantHint = (uid) => {
  try {
    return localStorage.getItem(tenantHintKey(uid));
  } catch {
    return null;
  }
};
const writeTenantHint = (uid, tenantId) => {
  try {
    localStorage.setItem(tenantHintKey(uid), tenantId);
  } catch {
    /* modo privado */
  }
};

const readPlans = () =>
  getDocs(collection(db, 'plans'))
    .then((snap) => Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])))
    .catch(() => ({}));

const buildGatewayAppUser = (gatewayUser) => {
  if (!gatewayUser) return null;
  const mappedRole = gatewayUser.role === 'technician' ? 'operator' : gatewayUser.role || 'operator';
  const entitlements = resolveEntitlements({
    tenant: { plan: 'enterprise', status: 'active' },
  });

  return {
    uid: gatewayUser.id,
    id: gatewayUser.id,
    email: gatewayUser.email,
    name: gatewayUser.name || 'Operador Nexus',
    tenantId: gatewayUser.tenantId || 'nexus-corp',
    role: mappedRole,
    gatewayRole: gatewayUser.role,
    department: gatewayUser.department || 'TI Corporativa',
    companyName: gatewayUser.tenantName || 'Nexus Indústria & Tecnologia S.A.',
    assetPrefix: gatewayUser.assetPrefix || 'NEX',
    logoUrl: '',
    primaryColor: null,
    hiddenModules: [],
    tenantStatus: 'active',
    entitlements,
    isMaster: false,
    authSource: 'gateway',
  };
};

/**
 * Resolve o usuario autenticado em uma sessao do app.
 * Nunca lanca: falhas viram `error` (texto para a UI) com tenant nulo, que as
 * rotas tratam como acesso negado (fail-closed).
 */
const resolveSession = async (user) => {
  if (!user) return { user: null, error: null };
  if (user.authSource === 'gateway') return { user, error: null };

  const base = { uid: user.uid, email: user.email, name: user.displayName || 'Usuário' };
  const denied = (error, extra = {}) => ({ user: { ...base, ...extra, tenantId: null, role: null }, error });

  try {
    const tokenResult = await user.getIdTokenResult();
    const claimTenantId = tokenResult.claims.tenantId || null;
    const claimRole = tokenResult.claims.role || null;

    const hintedTenant = claimTenantId || readTenantHint(user.uid);
    const plansPromise = readPlans();
    const prefetched = hintedTenant
      ? Promise.all([readDoc(['tenants', hintedTenant]), readDoc(['settings', hintedTenant])])
      : null;

    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const profile = userSnap.exists() ? userSnap.data() : null;
    const name = profile?.name || user.displayName || 'Membro Nexus';

    const tenantId = claimTenantId || profile?.tenantId || null;
    const role = claimRole || profile?.role || null;

    if (!tenantId || !role) {
      return denied(
        profile
          ? 'Perfil incompleto: entre em contato com o administrador da conta.'
          : 'Seu usuário ainda não está vinculado a uma empresa. Peça ao administrador um convite.',
        { name },
      );
    }

    if (isUserBlocked(profile?.status)) {
      return denied('Seu acesso foi suspenso pelo administrador da empresa.', { name, blocked: 'user' });
    }

    const [tenant, settings] = prefetched && hintedTenant === tenantId
      ? await prefetched
      : await Promise.all([readDoc(['tenants', tenantId]), readDoc(['settings', tenantId])]);
    writeTenantHint(user.uid, tenantId);

    if (tenantId !== MASTER_TENANT && tenant && isTenantBlocked(tenant.status)) {
      return denied(
        tenant.status === 'cancelled'
          ? 'A conta desta empresa foi encerrada. Fale com o suporte Nexus ITAM.'
          : 'A conta desta empresa está suspensa. Fale com o suporte Nexus ITAM para reativar.',
        { name, blocked: 'tenant', companyName: tenant.companyName },
      );
    }

    const plans = await plansPromise;
    const plan = tenant?.plan ? plans[String(tenant.plan).toLowerCase()] || null : null;
    const entitlements = resolveEntitlements({ tenant, plan });
    const branding = settings || {};

    touchLastLogin(user.uid, profile);

    return {
      user: {
        ...profile,
        uid: user.uid,
        email: user.email,
        tenantId,
        role,
        name,
        companyName: branding.companyName || tenant?.companyName || 'Nexus ITAM',
        logoUrl: safeImageUrl(branding.logoUrl),
        primaryColor: safeCssColor(branding.primaryColor),
        hiddenModules: Array.isArray(branding.hiddenModules) ? branding.hiddenModules : [],
        tenantStatus: tenant?.status || null,
        entitlements,
        isMaster: tenantId === MASTER_TENANT && role === 'superadmin',
        authSource: 'firebase',
      },
      error: null,
    };
  } catch (error) {
    console.error('Falha ao resolver o perfil multi-tenant:', error);
    return denied('Não foi possível validar suas permissões. Tente novamente.');
  }
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const resolveSeq = useRef(0);

  const applySession = useCallback(async (user) => {
    const seq = ++resolveSeq.current;
    const result = await resolveSession(user);
    if (seq === resolveSeq.current) {
      setProfileError(result.error);
      setCurrentUser(result.user);
      setLoading(false);
    }
    return result;
  }, []);

  const loginWithGateway = useCallback(async (email, password) => {
    const authData = await microservicesApi.authenticate(String(email || '').trim(), password);
    if (authData?.user?.role === 'collaborator') {
      clearGatewaySession();
      const err = new Error(
        'Contas de colaborador devem acessar o Portal de Autoatendimento (Vue 3). Use uma credencial administrativa ou técnica no Console ITAM.',
      );
      err.isGatewayPolicyError = true;
      throw err;
    }
    const appUser = buildGatewayAppUser(authData.user);
    setProfileError(null);
    setCurrentUser(appUser);
    setLoading(false);
    return { user: appUser };
  }, []);

  const login = useCallback(
    async (email, password) => {
      if (!isFirebaseConfigured) {
        return loginWithGateway(email, password);
      }
      return signInWithEmailAndPassword(auth, String(email || '').trim(), password);
    },
    [loginWithGateway],
  );

  const logout = useCallback(async () => {
    const wasGateway = currentUser?.authSource === 'gateway' || Boolean(getGatewaySession()?.token);
    clearGatewaySession();
    setCurrentUser(null);
    setProfileError(null);
    if (isFirebaseConfigured && auth.currentUser) {
      await signOut(auth).catch(() => {});
    } else if (!wasGateway && isFirebaseConfigured) {
      await signOut(auth).catch(() => {});
    }
  }, [currentUser?.authSource]);

  const refreshProfile = useCallback(() => {
    if (currentUser?.authSource === 'gateway' || (!isFirebaseConfigured && getGatewaySession()?.token)) {
      return microservicesApi
        .getMe()
        .then((res) => {
          if (res?.user) {
            setGatewaySession(res.token || getGatewaySession()?.token, res.user);
            setCurrentUser(buildGatewayAppUser(res.user));
          }
        })
        .catch(() => {
          clearGatewaySession();
          setCurrentUser(null);
        });
    }
    return applySession(auth.currentUser);
  }, [applySession, currentUser?.authSource]);

  const resetPassword = useCallback((email) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://itam-nexus.web.app';
    const actionCodeSettings = {
      url: `${origin}/reset-password`,
      handleCodeInApp: true,
    };
    return sendPasswordResetEmail(auth, email.trim(), actionCodeSettings);
  }, []);

  const registerTenant = useCallback(
    async (companyName, adminName, email, password) => {
      if (!isFirebaseConfigured) {
        throw new Error('Cadastro self-service de novas empresas está disponível apenas no modo Cloud Firebase.');
      }
      const cleanCompany = String(companyName || '').trim().slice(0, 120);
      const normalizedEmail = String(email || '').trim().toLowerCase();

      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      const user = userCredential.user;
      const tenantId = newTenantId(cleanCompany);

      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'tenants', tenantId), {
          id: tenantId,
          companyName: cleanCompany,
          ownerUid: user.uid,
          plan: 'starter',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'users', user.uid), {
          id: user.uid,
          email: normalizedEmail,
          name: String(adminName || '').trim(),
          tenantId,
          role: 'owner',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (error) {
        await user.delete().catch(() => {});
        throw error;
      }

      await setDoc(doc(db, 'settings', tenantId), buildInitialSettings(cleanCompany), { merge: true }).catch((error) =>
        console.warn('Configuracoes iniciais nao gravadas:', error),
      );

      await applySession(user);
      return { user, tenantId };
    },
    [applySession],
  );

  const acceptInvite = useCallback(
    async (inviteId, displayName) => {
      if (!isFirebaseConfigured) {
        throw new Error('Aceite de convites está disponível apenas no modo Cloud Firebase.');
      }
      const user = auth.currentUser;
      if (!user) throw new Error('Entre com a conta convidada para aceitar o convite.');

      let invite;
      try {
        const snap = await getDoc(doc(db, 'invites', inviteId));
        if (!snap.exists()) throw new Error('Convite não encontrado. Ele pode ter sido revogado.');
        invite = snap.data();
      } catch (error) {
        if (error?.code === 'permission-denied') {
          throw new Error(`Este convite não foi enviado para ${user.email}. Entre com o e-mail convidado.`);
        }
        throw error;
      }

      if (invite.status !== 'pending') throw new Error('Este convite já foi utilizado ou cancelado.');
      const expiresAt = toDate(invite.expiresAt);
      if (expiresAt && expiresAt < new Date()) throw new Error('Este convite expirou. Peça um novo ao administrador.');

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', user.uid), {
        id: user.uid,
        email: String(user.email || '').toLowerCase(),
        name: String(displayName || user.displayName || '').trim() || user.email,
        tenantId: invite.tenantId,
        role: invite.role,
        status: 'active',
        inviteId,
        invitedBy: invite.invitedBy || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'invites', inviteId), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
        acceptedBy: user.uid,
      });
      await batch.commit();

      return applySession(user);
    },
    [applySession],
  );

  // Inicialização de sessão híbrida (Gateway Fastify ou Firebase Auth)
  useEffect(() => {
    let active = true;

    // 1. Tenta restaurar sessão ativa do API Gateway
    const gwSession = getGatewaySession();
    if (gwSession?.token && gwSession?.user?.role !== 'collaborator') {
      const appUser = buildGatewayAppUser(gwSession.user);
      setCurrentUser(appUser);
      setLoading(false);

      microservicesApi
        .getMe()
        .then((res) => {
          if (!active) return;
          if (res?.user) {
            setGatewaySession(gwSession.token, res.user);
            setCurrentUser(buildGatewayAppUser(res.user));
          }
        })
        .catch(() => {
          if (!active) return;
          clearGatewaySession();
          if (!isFirebaseConfigured) {
            setCurrentUser(null);
            setLoading(false);
          }
        });
    }

    // 2. Se Firebase estiver configurado, escuta alterações de estado
    if (isFirebaseConfigured) {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!active) return;
        if (user) {
          setLoading(true);
          applySession(user);
        } else if (!getGatewaySession()?.token) {
          applySession(null);
        }
      });
      return () => {
        active = false;
        unsubscribe();
      };
    }

    // 3. Se Firebase NÃO estiver configurado e não houver sessão Gateway, encerra loading
    if (!gwSession?.token) {
      setLoading(false);
    }

    const unsubGateway = onGatewaySessionChange((session) => {
      if (!active) return;
      if (!session?.token && currentUser?.authSource === 'gateway') {
        setCurrentUser(null);
      }
    });

    return () => {
      active = false;
      unsubGateway();
    };
  }, [applySession, currentUser?.authSource]);

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      profileError,
      isGatewayOnly: !isFirebaseConfigured,
      login,
      loginWithGateway,
      logout,
      resetPassword,
      registerTenant,
      acceptInvite,
      refreshProfile,
    }),
    [
      currentUser,
      loading,
      profileError,
      login,
      loginWithGateway,
      logout,
      resetPassword,
      registerTenant,
      acceptInvite,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
