import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Depois de um deploy, uma aba antiga que abre uma rota lazy pede um chunk com
// hash que nao existe mais. Recarrega uma vez (marca em sessionStorage para
// nao entrar em loop se o problema for outro).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'nexus:preload-reload-ts';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 10000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
