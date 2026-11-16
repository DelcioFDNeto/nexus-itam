import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Depois de um deploy, uma aba antiga que abre uma rota lazy pede um chunk com
// hash que nao existe mais. Desregistra eventual Service Worker defasado e
// recarrega uma unica vez (com guarda de 60s em sessionStorage contra loops).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'nexus:preload-reload-ts';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 60000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  event.preventDefault();

  const reloadNow = () => window.location.reload();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) =>
        Promise.allSettled(
          regs.map((reg) => {
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            return reg.unregister();
          }),
        ),
      )
      .finally(reloadNow);
  } else {
    reloadNow();
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
