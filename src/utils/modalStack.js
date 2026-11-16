// src/utils/modalStack.js
// Detecta se um dialogo e o modal mais ao topo (ultimo [aria-modal] / alertdialog no DOM).
export const STACKED_MODAL_SELECTOR = '[aria-modal="true"], [role="alertdialog"]';

export const isTopmostModal = (el, doc = typeof document !== 'undefined' ? document : null) => {
  if (!el || !doc) return false;
  const modals = Array.from(doc.querySelectorAll(STACKED_MODAL_SELECTOR));
  if (modals.length === 0) return true;
  const top = modals[modals.length - 1];
  return top === el || el.contains(top);
};
