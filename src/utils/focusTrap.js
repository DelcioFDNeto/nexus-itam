// src/utils/focusTrap.js
// Utilitários compartilhados para captura, aprisionamento e restauração segura de foco.

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const MODAL_SELECTOR =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [aria-modal="true"]';

const isElementDisabled = (el) => {
  if (!el) return true;
  if (el.hasAttribute('disabled') || el.disabled) return true;
  const fieldset = el.closest('fieldset[disabled]');
  if (!fieldset) return false;
  const firstLegend = Array.from(fieldset.children).find((child) => child.tagName === 'LEGEND');
  return !(firstLegend && firstLegend.contains(el));
};

const isElementHidden = (el) => {
  if (!el || el.nodeType !== 1) return true;
  if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return true;

  const doc = el.ownerDocument;
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!win || typeof win.getComputedStyle !== 'function') return false;

  const ownStyle = win.getComputedStyle(el);
  if (ownStyle.visibility === 'hidden' || ownStyle.visibility === 'collapse') {
    return true;
  }

  let current = el;
  while (current && current.nodeType === 1) {
    const style = current === el ? ownStyle : win.getComputedStyle(current);
    if (style.display === 'none') return true;
    current = current.parentElement;
  }

  return false;
};

const hasNegativeTabIndex = (el) => {
  const raw = el.getAttribute('tabindex');
  if (raw === null) return false;
  const parsed = Number.parseInt(raw, 10);
  return !Number.isNaN(parsed) && parsed < 0;
};

const canReceiveFocus = (el) => {
  if (!el || el.nodeType !== 1 || typeof el.focus !== 'function') return false;
  if (!el.isConnected) return false;
  if (isElementDisabled(el)) return false;
  if (isElementHidden(el)) return false;
  return true;
};

/**
 * Retorna os elementos focalizáveis visíveis e ativos dentro de `container`.
 * Não depende de `offsetParent` para funcionar de forma confiável em JSDOM/Happy DOM.
 */
export const getFocusableElements = (container) => {
  if (!container || typeof container.querySelectorAll !== 'function') return [];

  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (!el || el.nodeType !== 1 || typeof el.focus !== 'function') return false;
    if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
    if (hasNegativeTabIndex(el)) return false;
    if (isElementDisabled(el)) return false;
    if (isElementHidden(el)) return false;
    return true;
  });
};

/**
 * Mantém a navegação por Tab / Shift+Tab confinada dentro de `container`.
 */
export const trapFocusWithin = (event, container) => {
  if (!event || event.key !== 'Tab' || !container) return;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    if (
      typeof container.focus === 'function' &&
      container.getAttribute('tabindex') !== null &&
      container.ownerDocument?.activeElement !== container
    ) {
      container.focus();
    }
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = container.ownerDocument?.activeElement;
  const isOutsideOrRoot = !active || active === container || !container.contains(active);

  if (event.shiftKey) {
    if (active === first || isOutsideOrRoot) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || isOutsideOrRoot) {
    event.preventDefault();
    first.focus();
  }
};

/**
 * Captura o elemento atualmente focado para futura restauração, ignorando
 * elementos dentro do próprio container ou em ancestrais inertes/ocultos.
 */
export const captureFocusTarget = (excludeContainer = null) => {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  if (!active || active.nodeType !== 1 || typeof active.focus !== 'function') return null;
  if (active === document.body || active === document.documentElement) return null;
  if (excludeContainer && excludeContainer.contains(active)) return null;
  if (!canReceiveFocus(active)) return null;
  return active;
};

/**
 * Restaura o foco para `previousEl` (ou `fallbackEl`), evitando elementos
 * desconectados, desabilitados, ocultos, inertes ou fora de outro modal ativo.
 */
export const restoreFocusSafely = (previousEl, fallbackEl = null, closingContainer = null) => {
  const doc =
    previousEl?.ownerDocument ||
    fallbackEl?.ownerDocument ||
    (typeof document !== 'undefined' ? document : null);

  let activeModal = null;
  if (doc) {
    const openModals = Array.from(doc.querySelectorAll(MODAL_SELECTOR)).filter(
      (modal) => !closingContainer || (modal !== closingContainer && !closingContainer.contains(modal)),
    );
    activeModal = openModals[openModals.length - 1] || null;
  }

  const isEligible = (el) => {
    if (!canReceiveFocus(el)) return false;
    if (activeModal && !activeModal.contains(el)) return false;
    return true;
  };

  const target = [previousEl, fallbackEl].find(isEligible);
  if (!target) return false;

  target.focus();
  return true;
};
