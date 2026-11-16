<script setup>
import { computed, ref } from 'vue';
import { useModalDialog } from '../composables/useModalDialog';
import { portalApi } from '../services/nexusApi';
import PortalIcon from './PortalIcon.vue';

defineProps({
  terms: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['signed', 'retry']);

const signingId = ref(null);
const verifyingId = ref(null);
const verificationResult = ref({});
const auditProofByTerm = ref({});
const actionError = ref('');
const termToSignModal = ref(null);
const signAgreed = ref(false);

const closeModalBtnRef = ref(null);
const modalPanelRef = ref(null);
const termsHeadingRef = ref(null);
const verifyBtnRefs = ref({});

const { requestClose: requestModalClose, handleBackdropClick } = useModalDialog({
  isOpen: computed(() => Boolean(termToSignModal.value)),
  dialogRef: modalPanelRef,
  initialFocusRef: closeModalBtnRef,
  fallbackFocusRef: termsHeadingRef,
  isBusy: () => signingId.value !== null,
  onClose: () => {
    termToSignModal.value = null;
    actionError.value = '';
  },
});

function formatPtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR');
}

function getStatusBadge(status) {
  if (status === 'signed') {
    return {
      label: 'Assinado digitalmente',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
      icon: 'check-circle',
    };
  }
  if (status === 'revoked') {
    return {
      label: 'Termo revogado',
      cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
      icon: 'x-circle',
    };
  }
  return {
    label: 'Aguardando assinatura',
    cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25',
    icon: 'alert-triangle',
  };
}

function isTamperedOrInvalid(res) {
  if (!res) return false;
  if (res.documentIntact === false) return true;
  if (res.status === 'signed' && !res.signatureValid) return true;
  return false;
}

function openSignModal(term) {
  termToSignModal.value = term;
  signAgreed.value = false;
  actionError.value = '';
}

async function confirmSign() {
  if (!termToSignModal.value || !signAgreed.value || signingId.value !== null) return;
  const termId = termToSignModal.value.id;
  actionError.value = '';
  signingId.value = termId;
  let signedOk = false;
  try {
    const signRes = await portalApi.signTerm(termId);
    signedOk = true;
    if (signRes?.auditProof) {
      auditProofByTerm.value[termId] = signRes.auditProof;
    }
    const check = await portalApi.verifyTermIntegrity(termId);
    verificationResult.value[termId] = check;
    signingId.value = null;
    const stableTargetRef = { value: verifyBtnRefs.value[termId] || termsHeadingRef.value };
    requestModalClose({
      force: true,
      preferFallback: true,
      customFallbackRef: stableTargetRef,
    });
    emit('signed');
  } catch (err) {
    if (signedOk) {
      emit('signed');
    }
    actionError.value = err.message || 'Falha ao assinar termo digitalmente.';
  } finally {
    signingId.value = null;
  }
}

async function handleVerify(termId) {
  actionError.value = '';
  verifyingId.value = termId;
  try {
    const check = await portalApi.verifyTermIntegrity(termId);
    verificationResult.value[termId] = check;
  } catch (err) {
    actionError.value = err.message || 'Falha ao verificar integridade do termo.';
  } finally {
    verifyingId.value = null;
  }
}
</script>

<template>
  <section class="space-y-6">
    <!-- Header -->
    <div
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-4"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-brand shrink-0" />
          <h2
            ref="termsHeadingRef"
            tabindex="-1"
            class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa] focus:outline-none"
          >
            Central de termos e conformidade CLT
          </h2>
        </div>
        <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl leading-relaxed">
          Instrumentos jurídicos de cessão, responsabilidade e guarda patrimonial em conformidade com
          o Artigo 462 da CLT e MP 2.200-2/2001.
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
        <span
          class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand/10 border border-brand-ring/30 text-brand-text-light dark:text-brand-text-dark text-xs font-mono font-semibold"
        >
          <PortalIcon name="shield-check" :size="16" />
          <span>Assinatura eletrônica avançada</span>
        </span>
      </div>
    </div>

    <!-- Page-Level Error Alert (hidden when modal is open because modal renders it inline) -->
    <div
      v-if="actionError && !termToSignModal"
      role="alert"
      aria-live="polite"
      class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3"
    >
      <div class="flex items-center gap-2 min-w-0">
        <PortalIcon name="alert-triangle" :size="16" class="text-rose-700 dark:text-rose-300" />
        <span class="break-words">{{ actionError }}</span>
      </div>
      <button
        type="button"
        class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        aria-label="Fechar alerta"
        @click="actionError = ''"
      >
        <PortalIcon name="x" :size="16" />
      </button>
    </div>

    <!-- Legal Compliance Callout Card -->
    <div
      class="station-panel p-4 sm:p-5 border-l-4 border-l-brand-ring bg-gradient-to-r from-brand/5 dark:from-brand/10 to-transparent flex items-start gap-3.5"
    >
      <div
        class="p-2.5 rounded-xl bg-brand border border-black/10 dark:border-white/15 text-brand-fg shrink-0 mt-0.5 shadow-sm"
      >
        <PortalIcon name="scale" :size="18" />
      </div>
      <div class="text-xs text-slate-700 dark:text-slate-200 space-y-1 min-w-0">
        <h3 class="font-semibold text-slate-900 dark:text-[#fafafa] text-xs sm:text-sm">
          Validade jurídica e integridade criptográfica (CLT Art. 462 §1º)
        </h3>
        <p class="leading-relaxed text-slate-600 dark:text-slate-300">
          Os termos eletrônicos assinados nesta central contam com carimbo de tempo, IP de origem e
          selo criptográfico HMAC-SHA256 registrado em cadeia imutável (Hash-Chain). Em caso de dano
          causado com culpa ou dolo, o instrumento digital possui plena eficácia jurídica conforme a
          legislação brasileira vigente.
        </p>
      </div>
    </div>

    <!-- Load Error State -->
    <div
      v-if="error && !loading && terms.length === 0"
      role="alert"
      class="station-panel p-8 text-center space-y-4 border-rose-500/30"
    >
      <div
        class="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300 mx-auto flex items-center justify-center"
      >
        <PortalIcon name="alert-triangle" :size="24" />
      </div>
      <div class="max-w-md mx-auto space-y-1">
        <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
          Falha ao carregar termos de responsabilidade
        </h3>
        <p class="text-xs text-slate-600 dark:text-slate-300 break-words">{{ error }}</p>
      </div>
      <button
        type="button"
        class="min-h-[44px] px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
        @click="emit('retry')"
      >
        Tentar novamente
      </button>
    </div>

    <!-- Loading Skeleton -->
    <div
      v-else-if="loading && terms.length === 0"
      role="status"
      aria-label="Carregando termos de responsabilidade"
      class="space-y-4"
    >
      <div v-for="n in 2" :key="n" class="station-panel p-6 space-y-4">
        <div class="flex items-center justify-between">
          <div class="w-40 h-6 rounded-full bg-slate-200 dark:bg-zinc-800 animate-pulse" />
          <div class="w-28 h-5 rounded bg-slate-200 dark:bg-zinc-800 animate-pulse" />
        </div>
        <div class="h-20 rounded-xl bg-slate-100 dark:bg-zinc-900 animate-pulse" />
        <span class="sr-only">Carregando termos de responsabilidade…</span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="terms.length === 0" class="station-panel p-12 text-center space-y-3">
      <div
        class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 mx-auto flex items-center justify-center"
      >
        <PortalIcon name="clipboard-check" :size="24" />
      </div>
      <div>
        <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
          Nenhum termo pendente no momento
        </h3>
        <p class="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto mt-1 leading-relaxed">
          Não há instrumentos de responsabilidade aguardando assinatura para o seu usuário. Todos os
          seus equipamentos ativos estão regulares.
        </p>
      </div>
    </div>

    <!-- Terms List -->
    <div v-else class="space-y-5">
      <article
        v-for="term in terms"
        :key="term.id"
        class="station-panel p-6 space-y-5 border-l-4 cert-guilloche-bg min-w-0"
        :class="
          term.status === 'signed'
            ? 'border-l-emerald-600 dark:border-l-emerald-400'
            : term.status === 'revoked'
              ? 'border-l-rose-600 dark:border-l-rose-400'
              : 'border-l-amber-600 dark:border-l-amber-400'
        "
      >
        <!-- Header Ribbon -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 pb-4"
        >
          <div class="flex items-center gap-2.5 flex-wrap">
            <span
              class="text-xs font-semibold px-3 py-1 rounded-full border shadow-sm inline-flex items-center gap-1.5"
              :class="getStatusBadge(term.status).cls"
            >
              <PortalIcon :name="getStatusBadge(term.status).icon" :size="14" />
              <span>{{ getStatusBadge(term.status).label }}</span>
            </span>
            <span
              class="font-mono text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-zinc-700"
            >
              Tipo:
              {{
                (term.term_type || term.termType) === 'entrega'
                  ? 'Cessão / Entrega'
                  : term.term_type || term.termType || 'Responsabilidade'
              }}
            </span>
          </div>

          <div class="text-xs font-sans">
            <span
              v-if="term.signed_at"
              class="text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1.5"
            >
              <PortalIcon name="check" :size="16" />
              <span>Assinado em {{ formatPtDate(term.signed_at) }}</span>
            </span>
            <span
              v-else
              class="text-amber-800 dark:text-amber-300 font-semibold inline-flex items-center gap-1.5"
            >
              <span class="w-2 h-2 rounded-full bg-amber-600 dark:bg-amber-400" />
              <span>Assinatura pendente</span>
            </span>
          </div>
        </div>

        <!-- Legal Statement Clause -->
        <div
          class="bg-slate-50/90 dark:bg-zinc-900/80 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-sans space-y-2 min-w-0"
        >
          <p class="font-semibold text-slate-900 dark:text-[#fafafa] text-xs flex items-center gap-1.5">
            <PortalIcon name="file-text" :size="16" class="text-brand-text-light dark:text-brand-text-dark" />
            <span>Cláusula de responsabilidade e guarda provisória</span>
          </p>
          <p class="text-slate-800 dark:text-slate-200 leading-relaxed font-medium break-words">
            {{ term.legal_clause }}
          </p>
        </div>

        <!-- Attached Hardware Snapshot -->
        <div class="space-y-2 min-w-0">
          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Equipamentos descritos no instrumento:
          </p>
          <div class="flex flex-wrap gap-2.5">
            <span
              v-for="(item, idx) in term.assets_snapshot || term.assetsSnapshot || []"
              :key="idx"
              class="font-mono text-xs font-semibold px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-slate-200 shadow-sm flex flex-wrap items-center gap-2 min-w-0 break-words"
            >
              <span class="font-bold text-brand-text-light dark:text-brand-text-dark">
                {{ item.internalId || item.internal_id }}
              </span>
              <span>— {{ item.model }}</span>
              <span
                v-if="item.serialNumber || item.serial_number"
                class="text-slate-600 dark:text-slate-300 font-normal break-all"
              >
                (S/N: {{ item.serialNumber || item.serial_number }})
              </span>
            </span>
          </div>
        </div>

        <!-- Verification & Signature Actions -->
        <div
          class="pt-3.5 border-t border-slate-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4"
        >
          <div class="space-y-1 min-w-0 max-w-full sm:max-w-md">
            <div
              class="font-mono text-xs text-slate-600 dark:text-slate-300 break-all"
              title="Hash criptográfico SHA-256 do documento"
            >
              Hash SHA-256:
              <span class="font-semibold text-slate-900 dark:text-[#fafafa]">
                {{ term.document_hash || term.documentHash || '—' }}
              </span>
            </div>
            <div v-if="term.signer_ip" class="font-mono text-xs text-slate-600 dark:text-slate-300 break-all">
              IP autenticado: {{ term.signer_ip }}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button
              v-if="term.status === 'pending'"
              type="button"
              :disabled="signingId === term.id"
              class="min-h-[44px] px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              @click="openSignModal(term)"
            >
              <PortalIcon name="pen-line" :size="16" />
              <span>{{ signingId === term.id ? 'Gravando selo…' : 'Assinar digitalmente' }}</span>
            </button>

            <button
              :ref="(el) => { if (el) verifyBtnRefs[term.id] = el; }"
              type="button"
              :disabled="verifyingId === term.id"
              class="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              @click="handleVerify(term.id)"
            >
              <PortalIcon name="search" :size="16" />
              <span>{{ verifyingId === term.id ? 'Auditando…' : 'Verificar autenticidade' }}</span>
            </button>
          </div>
        </div>

        <!-- Official Notarization / Verification Report -->
        <div
          v-if="verificationResult[term.id]"
          role="status"
          aria-live="polite"
          class="p-4 rounded-2xl border text-xs font-mono space-y-2 shadow-sm animate-fade-in min-w-0"
          :class="
            isTamperedOrInvalid(verificationResult[term.id])
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'
              : verificationResult[term.id].signatureValid
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
                : 'bg-slate-100 dark:bg-zinc-900 border-slate-300 dark:border-zinc-700 text-slate-800 dark:text-slate-200'
          "
        >
          <div class="font-bold text-sm flex items-center gap-2 font-sans">
            <template v-if="isTamperedOrInvalid(verificationResult[term.id])">
              <PortalIcon name="x-circle" :size="18" class="text-rose-700 dark:text-rose-300" />
              <span>Alerta: divergência ou assinatura inválida</span>
            </template>
            <template v-else-if="verificationResult[term.id].signatureValid">
              <PortalIcon name="check-circle" :size="18" class="text-emerald-700 dark:text-emerald-300" />
              <span>Certificado digital: assinatura e documento íntegros</span>
            </template>
            <template v-else>
              <PortalIcon name="check-circle" :size="18" class="text-slate-700 dark:text-slate-300" />
              <span>Integridade verificada (aguardando assinatura do colaborador)</span>
            </template>
          </div>
          <div class="text-xs text-slate-700 dark:text-slate-300 break-words">
            Algoritmo criptográfico:
            <span class="font-bold text-slate-900 dark:text-[#fafafa]">
              {{ verificationResult[term.id].algorithm }}
            </span>
          </div>
          <div
            v-if="verificationResult[term.id].signatureHash"
            class="text-xs text-slate-700 dark:text-slate-300 break-all"
          >
            Selo HMAC: <span class="font-bold">{{ verificationResult[term.id].signatureHash }}</span>
          </div>
          <div
            v-if="auditProofByTerm[term.id]"
            class="text-xs text-emerald-800 dark:text-emerald-300 break-all"
          >
            Registro imutável Hash-Chain #{{ auditProofByTerm[term.id].seq }}:
            {{ auditProofByTerm[term.id].entryHash }}
          </div>
        </div>
      </article>
    </div>

    <!-- Legal Signature Confirmation Modal -->
    <div
      v-if="termToSignModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-modal-title"
      class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      @click.self="handleBackdropClick"
    >
      <div
        ref="modalPanelRef"
        tabindex="-1"
        class="bg-white dark:bg-[#111113] rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 border border-slate-200 dark:border-zinc-800 animate-zoom-in max-h-[90vh] overflow-y-auto overscroll-contain focus:outline-none"
      >
        <div
          class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 pb-4"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-2xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0"
            >
              <PortalIcon name="pen-line" :size="20" />
            </div>
            <div class="min-w-0">
              <h3
                id="sign-modal-title"
                class="text-base sm:text-lg font-bold text-slate-900 dark:text-[#fafafa]"
              >
                Assinatura digital de termo CLT
              </h3>
              <p class="text-xs text-slate-600 dark:text-slate-300 font-mono break-all">
                Hash:
                {{ (termToSignModal.document_hash || termToSignModal.documentHash || '').slice(0, 16) }}…
              </p>
            </div>
          </div>
          <button
            ref="closeModalBtnRef"
            type="button"
            :disabled="signingId !== null"
            class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            aria-label="Fechar janela"
            @click="requestModalClose()"
          >
            <PortalIcon name="x" :size="18" />
          </button>
        </div>

        <div class="space-y-4 text-xs">
          <p class="text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
            Ao assinar este documento, você declara que recebeu os equipamentos listados em perfeito
            estado de funcionamento e conservação, assumindo sua guarda e zelo pessoal conforme as
            disposições do Artigo 462 §1º da Consolidação das Leis do Trabalho (CLT).
          </p>

          <div
            class="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200/80 dark:border-zinc-800 space-y-2"
          >
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
              Equipamentos vinculados:
            </span>
            <div class="space-y-1.5">
              <div
                v-for="(item, idx) in termToSignModal.assets_snapshot || termToSignModal.assetsSnapshot || []"
                :key="idx"
                class="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 min-w-0 break-words"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                <span>{{ item.internalId || item.internal_id }} — {{ item.model }}</span>
              </div>
            </div>
          </div>

          <label
            for="term-sign-agree"
            class="flex items-start gap-3 min-h-[44px] p-3.5 rounded-2xl bg-brand/5 dark:bg-brand/10 border border-brand-ring/30 cursor-pointer select-none"
          >
            <input
              id="term-sign-agree"
              v-model="signAgreed"
              name="signAgreed"
              type="checkbox"
              :disabled="signingId !== null"
              class="w-5 h-5 rounded accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring mt-0.5 cursor-pointer shrink-0 disabled:cursor-not-allowed"
            />
            <span class="text-xs text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
              Li e concordo integralmente com as condições do Termo de Responsabilidade e autorizo a
              gravação do selo criptográfico HMAC-SHA256 vinculado ao meu usuário e IP.
            </span>
          </label>
        </div>

        <!-- Inline Modal Error Alert -->
        <div
          v-if="actionError"
          role="alert"
          aria-live="polite"
          class="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-start gap-2"
        >
          <PortalIcon name="alert-triangle" :size="16" class="text-rose-700 dark:text-rose-300 mt-0.5" />
          <span class="break-words">{{ actionError }}</span>
        </div>

        <div
          class="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-100 dark:border-zinc-800"
        >
          <button
            type="button"
            :disabled="signingId !== null"
            class="min-h-[44px] text-xs font-semibold px-4 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="requestModalClose()"
          >
            Cancelar
          </button>
          <button
            type="button"
            :disabled="!signAgreed || signingId !== null"
            class="min-h-[44px] text-xs font-semibold px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="confirmSign"
          >
            {{ signingId !== null ? 'Gravando assinatura…' : 'Confirmar e assinar termo' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
