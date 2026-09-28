// src/contexts/AuthContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { auth, db } from '../services/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { MASTER_TENANT } from '../utils/permissions';
import { isTenantBlocked, isUserBlocked, resolveEntitlements } from '../utils/entitlements';
import { safeCssColor, safeImageUrl } from '../utils/sanitize';
import { buildInitialSettings, newTenantId } from '../services/tenantService';

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

/**
 * Resolve o usuario autenticado em uma sessao do app.
 * Nunca lanca: falhas viram `error` (texto para a UI) com tenant nulo, que as
 * rotas tratam como acesso negado (fail-closed).
 */
const resolveSession = async (user) => {
  if (!user) return { user: null, error: null };

  const base = { uid: user.uid, email: user.email, name: user.displayName || 'Usuário' };
  const denied = (error, extra = {}) => ({ user: { ...base, ...extra, tenantId: null, role: null }, error });

  try {
    // 1) Custom claims sao a fonte autoritativa (definidas pelo backend).
    //    O documento de perfil e apenas fallback de migracao.
    const tokenResult = await user.getIdTokenResult();
    const claimTenantId = tokenResult.claims.tenantId || null;
    const claimRole = tokenResult.claims.role || null;

    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const profile = userSnap.exists() ? userSnap.data() : null;
    const name = profile?.name || user.displayName || 'Membro Nexus';

    const tenantId = claimTenantId || profile?.tenantId || null;
    const role = claimRole || profile?.role || null;

    // FAIL-CLOSED: sem tenant ou sem papel o usuario entra sem privilegio algum.
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

    // 2) Empresa, identidade visual e plano. Falhas de leitura aqui nao
    //    bloqueiam: o bloqueio real esta nas regras do Firestore.
    const [tenant, settings] = await Promise.all([
      readDoc(['tenants', tenantId]),
      readDoc(['settings', tenantId]),
    ]);

    if (tenantId !== MASTER_TENANT && tenant && isTenantBlocked(tenant.status)) {
      return denied(
        tenant.status === 'cancelled'
          ? 'A conta desta empresa foi encerrada. Fale com o suporte Nexus ITAM.'
          : 'A conta desta empresa está suspensa. Fale com o suporte Nexus ITAM para reativar.',
        { name, blocked: 'tenant', companyName: tenant.companyName },
      );
    }

    const plan = tenant?.plan ? await readDoc(['plans', String(tenant.plan).toLowerCase()]) : null;
    const entitlements = resolveEntitlements({ tenant, plan });
    const branding = settings || {};

    touchLastLogin(user.uid, profile);

    return {
      user: {
        ...profile,
        uid: user.uid,
        email: user.email,
        // tenantId e role vem depois do spread: nenhum campo do documento
        // sobrescreve a decisao de autorizacao.
        tenantId,
        role,
        name,
        companyName: branding.companyName || tenant?.companyName || 'Nexus ITAM',
        logoUrl: safeImageUrl(branding.logoUrl),
        // Quem aplica a cor e o ThemeContext: duas fontes escrevendo
        // --color-brand faziam o acento pessoal e o whitelabel se anularem.
        primaryColor: safeCssColor(branding.primaryColor),
        hiddenModules: Array.isArray(branding.hiddenModules) ? branding.hiddenModules : [],
        tenantStatus: tenant?.status || null,
        entitlements,
        isMaster: tenantId === MASTER_TENANT && role === 'superadmin',
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
  // Erro de carregamento de perfil: mantido separado para a UI poder explicar
  // por que a sessao existe mas o acesso foi negado.
  const [profileError, setProfileError] = useState(null);

  // Cada resolucao recebe um numero; so a mais recente pode gravar o estado.
  // Sem isso, a resolucao disparada pelo login (ainda sem perfil) terminava
  // DEPOIS da criacao da empresa e deixava o recem-cadastrado sem acesso.
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

  /** Recarrega perfil, plano e identidade visual (ex.: apos salvar Configuracoes). */
  const refreshProfile = useCallback(() => applySession(auth.currentUser), [applySession]);

  const login = useCallback((email, password) => signInWithEmailAndPassword(auth, email.trim(), password), []);
  const logout = useCallback(() => signOut(auth), []);
  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email.trim()), []);

  // Cadastro de novo inquilino (SaaS B2B).
  // Empresa e perfil vao no MESMO batch: as regras so aceitam o perfil de owner
  // se a empresa nascer junto, apontando para este UID. A versao anterior lia
  // /tenants dentro de uma transacao antes de o perfil existir — a regra negava
  // a leitura e todo cadastro self-service falhava.
  const registerTenant = useCallback(async (companyName, adminName, email, password) => {
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
      // A conta de Auth ficaria orfa sem perfil: remove para o e-mail voltar a ficar livre.
      await user.delete().catch(() => {});
      throw error;
    }

    // Identidade inicial: nome e prefixo de patrimonio da propria empresa, em
    // vez dos padroes herdados da primeira cliente. Falha aqui nao desfaz o cadastro.
    await setDoc(doc(db, 'settings', tenantId), buildInitialSettings(cleanCompany), { merge: true }).catch((error) =>
      console.warn('Configuracoes iniciais nao gravadas:', error),
    );

    await applySession(user);
    return { user, tenantId };
  }, [applySession]);

  /**
   * Aceita um convite pendente com a conta ja autenticada.
   * Perfil e baixa do convite vao no mesmo batch — exigencia das regras.
   */
  const acceptInvite = useCallback(async (inviteId, displayName) => {
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
  }, [applySession]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Enquanto o perfil resolve, as rotas mostram carregamento em vez de
      // mandar o usuario de volta ao login.
      if (user) setLoading(true);
      applySession(user);
    });
    return unsubscribe;
  }, [applySession]);

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      profileError,
      login,
      logout,
      resetPassword,
      registerTenant,
      acceptInvite,
      refreshProfile,
    }),
    [currentUser, loading, profileError, login, logout, resetPassword, registerTenant, acceptInvite, refreshProfile],
  );

  // Renderiza sempre: as rotas decidem o que mostrar durante `loading`.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
