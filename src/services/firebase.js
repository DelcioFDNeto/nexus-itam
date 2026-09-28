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

// Exportado para o console master, que abre uma instancia secundaria do app
// para criar contas sem derrubar a propria sessao.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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

if (USE_EMULATORS) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Persistencia local de autenticacao indisponivel.", error);
});

export { db, auth };
