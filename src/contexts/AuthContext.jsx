// src/contexts/AuthContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, db } from '../services/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { MASTER_TENANT } from '../utils/permissions';
import { safeCssColor, safeImageUrl } from '../utils/sanitize';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Erro de carregamento de perfil: mantido separado para a UI poder explicar
  // por que a sessao existe mas o acesso foi negado.
  const [profileError, setProfileError] = useState(null);

  const login = useCallback((email, password) => signInWithEmailAndPassword(auth, email, password), []);
  const logout = useCallback(() => signOut(auth), []);
  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email), []);

  // Cadastro de novo inquilino (SaaS B2B).
  // Tenant e perfil sao gravados na mesma transacao: nunca sobra um usuario orfao.
  const registerTenant = useCallback(async (companyName, adminName, email, password) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    const suffix = Math.random().toString(36).slice(2, 8);
    const base = slugify(companyName) || 'empresa';
    const tenantId = `${base}-${suffix}`;

    try {
      await runTransaction(db, async (tx) => {
        const tenantRef = doc(db, 'tenants', tenantId);
        if ((await tx.get(tenantRef)).exists()) {
          throw new Error('Identificador de empresa ja utilizado. Tente novamente.');
        }

        tx.set(tenantRef, {
          id: tenantId,
          companyName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          status: 'active',
          plan: 'starter',
        });

        tx.set(doc(db, 'users', user.uid), {
          id: user.uid,
          email,
          name: adminName,
          tenantId,
          role: 'owner',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      // A conta de Auth ficaria orfa sem perfil: remove para o e-mail voltar a ficar livre.
      await user.delete().catch(() => {});
      throw error;
    }

    return { user, tenantId };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCurrentUser(null);
        setProfileError(null);
        setLoading(false);
        return;
      }

      try {
        // 1) Custom claims sao a fonte autoritativa (definidas pelo backend).
        //    O documento de perfil e apenas fallback de migracao.
        const tokenResult = await user.getIdTokenResult();
        const claimTenantId = tokenResult.claims.tenantId || null;
        const claimRole = tokenResult.claims.role || null;

        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const profile = userSnap.exists() ? userSnap.data() : null;

        const tenantId = claimTenantId || profile?.tenantId || null;
        const role = claimRole || profile?.role || null;

        // FAIL-CLOSED: sem tenant ou sem papel o usuario entra sem privilegio
        // algum. Antes, uma falha de leitura promovia o usuario a 'owner'.
        if (!tenantId || !role) {
          setProfileError(
            profile
              ? 'Perfil incompleto: entre em contato com o administrador da conta.'
              : 'Usuario autenticado sem perfil vinculado a uma empresa.',
          );
          setCurrentUser({
            uid: user.uid,
            email: user.email,
            name: profile?.name || user.displayName || 'Usuario',
            tenantId: null,
            role: null,
          });
          setLoading(false);
          return;
        }

        // 2) Branding do inquilino (whitelabel). Falha aqui nao bloqueia o login.
        let tenantConfig = {};
        try {
          const settingsSnap = await getDoc(doc(db, 'settings', tenantId));
          if (settingsSnap.exists()) tenantConfig = settingsSnap.data();
        } catch {
          tenantConfig = {};
        }

        setProfileError(null);
        setCurrentUser({
          ...profile,
          uid: user.uid,
          email: user.email,
          // tenantId e role vem por ultimo: nenhum campo do documento sobrescreve
          // a decisao de autorizacao.
          tenantId,
          role,
          name: profile?.name || user.displayName || 'Membro Nexus',
          logoUrl: safeImageUrl(tenantConfig.logoUrl),
          companyName: tenantConfig.companyName || 'Nexus ITAM',
          // Quem aplica a cor e o ThemeContext: duas fontes escrevendo
          // --color-brand faziam o acento pessoal e o whitelabel se anularem.
          primaryColor: safeCssColor(tenantConfig.primaryColor),
          isMaster: tenantId === MASTER_TENANT && role === 'superadmin',
        });
      } catch (error) {
        console.error('Falha ao resolver o perfil multi-tenant:', error);
        setProfileError('Nao foi possivel validar suas permissoes. Tente novamente.');
        setCurrentUser({
          uid: user.uid,
          email: user.email,
          name: user.displayName || 'Usuario',
          tenantId: null,
          role: null,
        });
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const value = useMemo(
    () => ({ currentUser, loading, profileError, login, logout, resetPassword, registerTenant }),
    [currentUser, loading, profileError, login, logout, resetPassword, registerTenant],
  );

  // Renderiza sempre: as rotas decidem o que mostrar durante `loading`.
  // Antes o app inteiro ficava em branco ate a resolucao do perfil.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
