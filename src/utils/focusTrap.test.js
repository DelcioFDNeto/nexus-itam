// src/utils/focusTrap.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFocusableElements,
  trapFocusWithin,
  captureFocusTarget,
  restoreFocusSafely,
} from './focusTrap';

describe('focusTrap utils', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  describe('getFocusableElements', () => {
    it('filtra elementos inert, aria-hidden, disabled, hidden e display:none/visibility:hidden', () => {
      root.innerHTML = `
        <div id="container">
          <button id="valid-btn">Válido</button>
          <a id="valid-link" href="/assets">Link</a>
          <input id="valid-input" type="text" />
          <input id="hidden-input" type="hidden" />
          <button id="disabled-btn" disabled>Desabilitado</button>
          <button id="aria-hidden-btn" aria-hidden="true">Oculto SR</button>
          <div aria-hidden="true"><button id="nested-aria-hidden">Filho oculto</button></div>
          <div inert><button id="inert-btn">Inerte</button></div>
          <button id="hidden-attr-btn" hidden>Hidden attr</button>
          <div style="display: none"><button id="display-none-child">Display none</button></div>
          <button id="visibility-hidden-btn" style="visibility: hidden">Visibility hidden</button>
          <div tabindex="-1" id="neg-tabindex">Tab -1</div>
          <div tabindex="0" id="custom-tabindex">Tab 0</div>
        </div>
      `;

      const container = root.querySelector('#container');
      const ids = getFocusableElements(container).map((el) => el.id);

      expect(ids).toEqual(['valid-btn', 'valid-link', 'valid-input', 'custom-tabindex']);
    });

    it('retorna array vazio para container nulo ou sem elementos focalizaveis', () => {
      expect(getFocusableElements(null)).toEqual([]);
      root.innerHTML = '<div id="empty"><p>Sem foco</p></div>';
      expect(getFocusableElements(root.querySelector('#empty'))).toEqual([]);
    });
  });

  describe('trapFocusWithin', () => {
    it('cicla foco entre primeiro e ultimo elemento com Tab e Shift+Tab', () => {
      root.innerHTML = `
        <div id="modal" tabindex="-1">
          <button id="first">Primeiro</button>
          <button id="middle">Meio</button>
          <button id="last">Último</button>
        </div>
      `;

      const modal = root.querySelector('#modal');
      const first = root.querySelector('#first');
      const last = root.querySelector('#last');

      last.focus();
      const tabOnLast = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      trapFocusWithin(tabOnLast, modal);
      expect(tabOnLast.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      const shiftTabOnFirst = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        cancelable: true,
      });
      trapFocusWithin(shiftTabOnFirst, modal);
      expect(shiftTabOnFirst.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it('redireciona foco para dentro quando activeElement esta no container raiz ou fora', () => {
      root.innerHTML = `
        <button id="outside">Fora</button>
        <div id="modal" tabindex="-1">
          <button id="first">Primeiro</button>
          <button id="last">Último</button>
        </div>
      `;

      const modal = root.querySelector('#modal');
      const outside = root.querySelector('#outside');
      const first = root.querySelector('#first');
      const last = root.querySelector('#last');

      outside.focus();
      const tabFromOutside = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      trapFocusWithin(tabFromOutside, modal);
      expect(tabFromOutside.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      modal.focus();
      const shiftTabFromRoot = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        cancelable: true,
      });
      trapFocusWithin(shiftTabFromRoot, modal);
      expect(shiftTabFromRoot.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    });
  });

  describe('captureFocusTarget & restoreFocusSafely', () => {
    it('nao captura elemento dentro de ancestral inert ou do container excluido', () => {
      root.innerHTML = `
        <aside inert><button id="inert-trigger">Inerte</button></aside>
        <div id="modal"><button id="inside">Dentro</button></div>
        <button id="valid-trigger">Válido</button>
      `;

      const inertTrigger = root.querySelector('#inert-trigger');
      const inside = root.querySelector('#inside');
      const modal = root.querySelector('#modal');
      const validTrigger = root.querySelector('#valid-trigger');

      inertTrigger.focus();
      expect(captureFocusTarget(modal)).toBeNull();

      inside.focus();
      expect(captureFocusTarget(modal)).toBeNull();

      validTrigger.focus();
      expect(captureFocusTarget(modal)).toBe(validTrigger);
    });

    it('restaura foco para fallback quando elemento anterior ficou inert, oculto ou desconectado', () => {
      root.innerHTML = `
        <aside id="drawer"><button id="drawer-btn">Drawer</button></aside>
        <button id="fallback">Fallback</button>
      `;

      const drawer = root.querySelector('#drawer');
      const drawerBtn = root.querySelector('#drawer-btn');
      const fallback = root.querySelector('#fallback');

      drawer.setAttribute('inert', '');
      expect(restoreFocusSafely(drawerBtn, fallback)).toBe(true);
      expect(document.activeElement).toBe(fallback);

      drawerBtn.remove();
      fallback.disabled = true;
      expect(restoreFocusSafely(drawerBtn, fallback)).toBe(false);
    });

    it('nao rouba foco para fora quando existe outro dialog aria-modal="true" aberto', () => {
      root.innerHTML = `
        <button id="outside-btn">Fora</button>
        <div role="dialog" aria-modal="true" id="open-modal">
          <button id="modal-btn">Modal</button>
        </div>
      `;

      const outsideBtn = root.querySelector('#outside-btn');
      const modalBtn = root.querySelector('#modal-btn');
      modalBtn.focus();

      expect(restoreFocusSafely(outsideBtn)).toBe(false);
      expect(document.activeElement).toBe(modalBtn);

      // Mas permite restaurar para dentro do próprio modal ativo
      const openModal = root.querySelector('#open-modal');
      const innerBtn = document.createElement('button');
      innerBtn.id = 'inner-btn';
      openModal.appendChild(innerBtn);

      expect(restoreFocusSafely(innerBtn)).toBe(true);
      expect(document.activeElement).toBe(innerBtn);
    });

    it('respeita alertdialog aria-modal e parametro closingContainer', () => {
      root.innerHTML = `
        <button id="origin">Origem</button>
        <div role="alertdialog" aria-modal="true" id="alert-modal">
          <button id="alert-btn">Confirmar</button>
        </div>
      `;

      const origin = root.querySelector('#origin');
      const alertModal = root.querySelector('#alert-modal');
      const alertBtn = root.querySelector('#alert-btn');
      alertBtn.focus();

      expect(restoreFocusSafely(origin)).toBe(false);
      expect(restoreFocusSafely(origin, null, alertModal)).toBe(true);
      expect(document.activeElement).toBe(origin);
    });

    it('filtra controles dentro de fieldset[disabled] exceto no primeiro legend', () => {
      root.innerHTML = `
        <div id="box">
          <fieldset disabled>
            <legend><button id="legend-btn">No legend</button></legend>
            <button id="inside-disabled-fieldset">Bloqueado</button>
          </fieldset>
        </div>
      `;

      const ids = getFocusableElements(root.querySelector('#box')).map((el) => el.id);
      expect(ids).toEqual(['legend-btn']);
    });
  });
});
