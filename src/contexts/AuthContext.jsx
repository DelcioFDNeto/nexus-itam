// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../services/firebase';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const AuthContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const logout = () => {
    return signOut(auth);
  };

  const resetPassword = (email) => {
    return sendPasswordResetEmail(auth, email);
  };

  // Cadastro de novo Inquilino (SaaS B2B)
  const registerTenant = async (companyName, adminName, email, password) => {
    // 1. Cria usuário no Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Generar tenantId baseado no nome ou ID aleatório
    const tenantId = `tenant-${Math.random().toString(36).substring(2, 9)}`;

    // 2. Salvar metadados da empresa na coleção 'tenants'
    await setDoc(doc(db, 'tenants', tenantId), {
      id: tenantId,
      companyName: companyName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'active',
      plan: 'starter'
    });

    // 3. Salvar perfil do usuário associado a esse tenant com perfil 'owner'
    await setDoc(doc(db, 'users', user.uid), {
      id: user.uid,
      email: email,
      name: adminName,
      tenantId: tenantId,
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { user, tenantId };
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Busca o perfil do usuário no Firestore
          const userDocRef = doc(db, 'users', user.uid);
          let userDoc = await getDoc(userDocRef);
          let userData = userDoc.exists() ? userDoc.data() : null;

          // Promoção automática de delciofarias04@gmail.com para superadmin (case-insensitive)
          if (user.email && user.email.toLowerCase() === 'delciofarias04@gmail.com') {
            let needsUpdate = false;
            
            if (!userData) {
              userData = {
                id: user.uid,
                email: user.email,
                name: 'Délcio Farias',
                tenantId: 'nexus-master',
                role: 'superadmin',
                status: 'active',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              };
              needsUpdate = true;
            } else if (userData.role !== 'superadmin' || userData.tenantId !== 'nexus-master' || userData.name !== 'Délcio Farias') {
              userData.role = 'superadmin';
              userData.tenantId = 'nexus-master';
              userData.name = 'Délcio Farias';
              userData.updatedAt = serverTimestamp();
              needsUpdate = true;
            }

            if (needsUpdate) {
              await setDoc(userDocRef, userData, { merge: true });
            }

            // Garante que o tenant 'nexus-master' existe e tem o nome correto
            const tenantDocRef = doc(db, 'tenants', 'nexus-master');
            const tenantDoc = await getDoc(tenantDocRef);
            if (!tenantDoc.exists()) {
              await setDoc(tenantDocRef, {
                id: 'nexus-master',
                companyName: 'Nexus ITAM',
                status: 'active',
                plan: 'enterprise',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            } else if (tenantDoc.data().companyName !== 'Nexus ITAM') {
              await setDoc(tenantDocRef, { companyName: 'Nexus ITAM' }, { merge: true });
            }
          }

          if (userData) {
            // Busca as customizações visuais do inquilino
            let tenantConfig = {};
            if (userData.tenantId) {
              const settingsDocRef = doc(db, 'settings', userData.tenantId);
              const settingsDoc = await getDoc(settingsDocRef);
              if (settingsDoc.exists()) {
                tenantConfig = settingsDoc.data();
                if (tenantConfig.primaryColor) {
                  document.documentElement.style.setProperty('--color-brand', tenantConfig.primaryColor);
                }
              }
            }

            setCurrentUser({
              uid: user.uid,
              email: user.email,
              tenantId: userData.tenantId,
              role: userData.role,
              name: userData.name || user.displayName || 'Membro Nexus',
              logoUrl: tenantConfig.logoUrl || '',
              companyName: tenantConfig.companyName || 'Nexus ITAM',
              ...userData
            });
          } else {
            // Se o documento do usuário ainda não existir (caso de usuários antigos ou admin local)
            // Define perfil padrão para manter a retrocompatibilidade
            setCurrentUser({
              uid: user.uid,
              email: user.email,
              tenantId: 'default-tenant',
              role: 'owner',
              name: user.displayName || 'Admin Nexus'
            });
          }
        } catch (error) {
          console.error("Erro ao buscar dados do perfil multi-tenant:", error);
          // Fallback para evitar travar o login caso falte a coleção 'users' temporariamente
          setCurrentUser({
            uid: user.uid,
            email: user.email,
            tenantId: 'default-tenant',
            role: 'owner',
            name: user.displayName || 'Admin Nexus'
          });
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    login,
    logout,
    resetPassword,
    registerTenant
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};