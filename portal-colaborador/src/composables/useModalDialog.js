// portal-colaborador/src/composables/useModalDialog.js
// =============================================================================
// Composable compartilhado para diálogos acessíveis (Focus Trap, Esc, Scroll Lock)
// =============================================================================

import { nextTick, onBeforeUnmount, watch } from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useModalDialog({
  isOpen,
  dialogRef,
  initialFocusRef,
  fallbackFocusRef,
  isBusy = () => false,
  onClose,
}) {
  let lastFocusedEl = null;
  let previousOverflow = '';

  function getFocusableElements() {
    const container = dialogRef?.value;
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }

  function restoreFocus({ preferFallback = false, customFallbackRef } = {}) {
    nextTick(() => {
      if (
        !preferFallback &&
        lastFocusedEl &&
        lastFocusedEl.isConnected &&
        typeof lastFocusedEl.focus === 'function'
      ) {
        lastFocusedEl.focus();
      } else {
        const target = customFallbackRef?.value || fallbackFocusRef?.value;
        if (target && target.isConnected && typeof target.focus === 'function') {
          target.focus();
        }
      }
      lastFocusedEl = null;
    });
  }

  function requestClose({ force = false, preferFallback = false, customFallbackRef } = {}) {
    if (!force && isBusy()) return false;
    onClose?.();
    restoreFocus({ preferFallback, customFallbackRef });
    return true;
  }

  function onKeydown(event) {
    if (!isOpen.value) return;

    if (event.key === 'Escape') {
      if (!isBusy()) {
        event.preventDefault();
        requestClose();
      }
      return;
    }

    if (event.key === 'Tab') {
      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        event.preventDefault();
        dialogRef?.value?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogRef?.value?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef?.value?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  watch(
    isOpen,
    async (open) => {
      if (typeof window === 'undefined') return;
      if (open) {
        lastFocusedEl = document.activeElement;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKeydown);
        await nextTick();
        const initialEl = initialFocusRef?.value;
        if (initialEl && typeof initialEl.focus === 'function') {
          initialEl.focus();
        } else {
          const focusables = getFocusableElements();
          if (focusables[0]) focusables[0].focus();
          else dialogRef?.value?.focus();
        }
      } else {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', onKeydown);
      }
    },
    { flush: 'post' },
  );

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
      if (isOpen.value) {
        document.body.style.overflow = previousOverflow;
      }
    }
  });

  return {
    requestClose,
    handleBackdropClick: () => requestClose(),
  };
}
