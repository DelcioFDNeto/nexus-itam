import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Depois de um deploy, uma aba antiga que abre uma rota lazy pede um chunk com
// hash que nao existe mais. Recarrega uma vez (marca em sessionStorage para
// nao entrar em loop se o problema for outro).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'nexus:preload-reload';
  if (sessionStorage.getItem(KEY)) return;
  sessionStorage.setItem(KEY, '1');
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem('nexus:preload-reload'), 10000);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
