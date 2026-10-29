// src/services/firebase.js
import { initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from "firebase/auth";

/**
 * Indica se as credenciais reais do Firebase Cloud foram injetadas no build.
 * Na VPS Self-Hosted (Docker / PostgreSQL 16 + Fastify), as variáveis VITE_FIREBASE_*
 * podem estar vazias ("") — neste modo inicializamos um app Firebase inerte offline
 * para não disparar `FirebaseError: auth/invalid-api-key` na importação dos módulos
 * legados, delegando autenticação e persistência integralmente ao API Gateway.
 */
export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY?.trim() &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
);

// Exportado para o console master, que abre uma instancia secundaria do app
// para criar contas sem derrubar a propria sessao.
export const firebaseConfig = isFirebaseConfigured
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }
  : {
      apiKey: "AIzaSyDummyVpsOfflineMode0000000000000",
      authDomain: "nexus-vps-offline.local",
      projectId: "nexus-vps-offline",
      storageBucket: "nexus-vps-offline.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:0000000000000000",
    };

// Desenvolvimento local contra os emuladores (`firebase emulators:start`):
// VITE_USE_EMULATORS=true. Nunca ativo em producao.
const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === "true";

/** Aponta uma instancia de Auth para o emulador quando ele estiver em uso. */
export const connectAuthIfEmulated = (authInstance) => {
  if (USE_EMULATORS) {
    connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return authInstance;
};

const app = initializeApp(firebaseConfig);
const auth = connectAuthIfEmulated(getAuth(app));

let db;

if (isFirebaseConfigured || USE_EMULATORS) {
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    console.warn("Persistencia local do Firestore indisponivel, usando conexao padrao.", error);
    db = getFirestore(app);
  }
} else {
  // Modo VPS Self-Hosted sem chaves Firebase: instância em memória pura (zero IndexedDB / rede)
  try {
    db = initializeFirestore(app, {});
  } catch {
    db = getFirestore(app);
  }
}

if (USE_EMULATORS) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

if (isFirebaseConfigured || USE_EMULATORS) {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Persistencia local de autenticacao indisponivel.", error);
  });
}

export { db, auth };
