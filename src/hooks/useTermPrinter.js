// src/hooks/useTermPrinter.js
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTenantSettings } from './useTenantSettings';
import { openPrintWindow, printHtml, resolvePrintBranding } from '../utils/printTemplates';
import { buildTermDocumentFor } from '../utils/termDocuments';
import { resolveTermOptions } from '../utils/terms';

/** Endereco do termo no app: e o que o QR impresso abre (ex.: na loja, para conferir). */
export const termUrl = (termId) => `${window.location.origin}/termos/${termId}`;

/**
 * Impressao de termos com a identidade e as opcoes da empresa.
 *   const { printTerm, openWindow } = useTermPrinter();
 *   printTerm(term)                     // reimpressao
 *   const win = openWindow();           // ANTES do await (evita bloqueio de popup)
 *   const term = await issue(...);
 *   printTerm(term, { win });
 */
export const useTermPrinter = () => {
  const { currentUser } = useAuth();
  const { settings } = useTenantSettings();

  const build = useCallback(
    (term, { draft = false } = {}) =>
      buildTermDocumentFor(term, resolvePrintBranding(settings, currentUser), resolveTermOptions(settings), {
        draft,
        url: term.id && !draft ? termUrl(term.id) : '',
      }),
    [settings, currentUser],
  );

  const printTerm = useCallback(
    (term, { draft = false, win = null } = {}) => {
      const html = build(term, { draft });
      if (win) {
        win.print(html);
        return true;
      }
      const ok = printHtml(html);
      if (!ok) toast.error('Popup bloqueado! Permita popups para imprimir.');
      return ok;
    },
    [build],
  );

  const openWindow = useCallback(() => {
    const win = openPrintWindow('Registrando o termo…');
    if (!win) toast.error('Popup bloqueado! O termo será registrado; reimprima pela tela Termos.');
    return win;
  }, []);

  return { printTerm, openWindow, settings };
};
