<script setup>
import { ref } from 'vue';
import { portalApi } from '../services/nexusApi';

defineProps({
  terms: { type: Array, required: true },
});

const emit = defineEmits(['signed']);

const signingId = ref(null);
const verifyingId = ref(null);
const verificationResult = ref({});
const auditProofByTerm = ref({});
const actionError = ref('');
const termToSignModal = ref(null);
const signAgreed = ref(false);

function formatPtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR');
}

function getStatusBadge(status) {
  if (status === 'signed') {
    return {
      label: 'Assinado Digitalmente',
      cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      icon: '✓',
    };
  }
  if (status === 'revoked') {
    return {
      label: 'Termo Revogado',
      cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
      icon: '✕',
    };
  }
  return {
    label: 'Aguardando Assinatura',
    cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    icon: '⚠️',
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
  if (!termToSignModal.value || !signAgreed.value) return;
  const termId = termToSignModal.value.id;
  actionError.value = '';
  signingId.value = termId;
  try {
    const signRes = await portalApi.signTerm(termId);
    if (signRes?.auditProof) {
      auditProofByTerm.value[termId] = signRes.auditProof;
    }
    const check = await portalApi.verifyTermIntegrity(termId);
    verificationResult.value[termId] = check;
    termToSignModal.value = null;
    emit('signed');
  } catch (err) {
    actionError.value = err.message;
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
    actionError.value = err.message;
  } finally {
    verifyingId.value = null;
  }
}
</script>

<template>
  <section class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
      <div>
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse shadow-xs shadow-indigo-500/50" />
          <h2 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Central de Termos & Conformidade CLT
          </h2>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
          Instrumentos jurídicos de cessão, responsabilidade e guarda patrimonial em conformidade com o Artigo 462 da CLT e MP 2.200-2/2001.
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
        <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-mono font-bold">
          <span>🛡️ Assinatura Eletrônica Avançada</span>
        </span>
      </div>
    </div>

    <!-- Error Alert -->
    <div
      v-if="actionError"
      class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-700 dark:text-red-400 flex items-center justify-between"
    >
      <span>⚠️ {{ actionError }}</span>
      <button type="button" class="text-red-500 hover:text-red-700 font-black cursor-pointer" @click="actionError = ''">
        ✕
      </button>
    </div>

    <!-- Legal Compliance Callout Card -->
    <div class="station-panel p-4 sm:p-5 border-l-4 border-l-indigo-600 bg-gradient-to-r from-indigo-50/60 dark:from-indigo-950/20 to-transparent flex items-start gap-3.5">
      <div class="p-2.5 rounded-xl bg-indigo-600 text-white shrink-0 mt-0.5 shadow-sm">
        ⚖️
      </div>
      <div class="text-xs text-slate-700 dark:text-slate-300 space-y-1">
        <h3 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wide">
          Validade Jurídica & Integridade Criptográfica (CLT Art. 462 §1º)
        </h3>
        <p class="leading-relaxed text-slate-600 dark:text-slate-400">
          Os termos eletrônicos assinados nesta central contam com carimbo de tempo, IP de origem e selo criptográfico HMAC-SHA256 registrado em cadeia imutável (Hash-Chain). Em caso de dano causado com culpa ou dolo, o instrumento digital possui plena eficácia jurídica conforme a legislação brasileira vigente.
        </p>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="terms.length === 0"
      class="station-panel p-16 text-center space-y-3"
    >
      <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mx-auto flex items-center justify-center text-2xl">
        📋
      </div>
      <div>
        <h3 class="text-sm font-black text-slate-800 dark:text-slate-200">
          Nenhum termo pendente no momento
        </h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
          Não há instrumentos de responsabilidade aguardando assinatura para o seu usuário. Todos os seus equipamentos ativos estão regulares.
        </p>
      </div>
    </div>

    <!-- Terms List -->
    <div v-else class="space-y-5">
      <article
        v-for="term in terms"
        :key="term.id"
        class="station-panel p-6 space-y-5 border-l-4 cert-guilloche-bg"
        :class="
          term.status === 'signed'
            ? 'border-l-emerald-500'
            : term.status === 'revoked'
              ? 'border-l-red-500'
              : 'border-l-amber-500'
        "
      >
        <!-- Header Ribbon -->
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span
              class="text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full border shadow-2xs flex items-center gap-1.5"
              :class="getStatusBadge(term.status).cls"
            >
              <span>{{ getStatusBadge(term.status).icon }}</span>
              <span>{{ getStatusBadge(term.status).label }}</span>
            </span>
            <span class="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Tipo: {{ (term.term_type || term.termType) === 'entrega' ? 'Cessão / Entrega' : (term.term_type || term.termType || 'Responsabilidade') }}
            </span>
          </div>

          <div class="text-xs font-sans">
            <span v-if="term.signed_at" class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <span>✓</span>
              <span>Assinado em {{ formatPtDate(term.signed_at) }}</span>
            </span>
            <span v-else class="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              <span>Assinatura Pendente</span>
            </span>
          </div>
        </div>

        <!-- Legal Statement Clause -->
        <div class="bg-slate-50/90 dark:bg-slate-800/60 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans space-y-2">
          <p class="font-black text-slate-900 dark:text-white uppercase text-[10px] tracking-wider flex items-center gap-1.5">
            <span>📜</span>
            <span>Cláusula de Responsabilidade e Guarda Provisória</span>
          </p>
          <p class="text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
            {{ term.legal_clause }}
          </p>
        </div>

        <!-- Attached Hardware Snapshot -->
        <div class="space-y-2">
          <p class="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Equipamentos Descritos no Instrumento:
          </p>
          <div class="flex flex-wrap gap-2.5">
            <span
              v-for="(item, idx) in (term.assets_snapshot || term.assetsSnapshot || [])"
              :key="idx"
              class="font-mono text-xs font-semibold px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 shadow-2xs flex items-center gap-2"
            >
              <span class="font-black text-brand">{{ item.internalId || item.internal_id }}</span>
              <span>— {{ item.model }}</span>
              <span v-if="item.serialNumber || item.serial_number" class="text-slate-400 dark:text-slate-500 font-normal">
                (S/N: {{ item.serialNumber || item.serial_number }})
              </span>
            </span>
          </div>
        </div>

        <!-- Verification & Signature Actions -->
        <div class="pt-3.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-1 max-w-md">
            <div class="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate" title="Hash criptográfico SHA-256 do documento">
              Hash SHA-256: <span class="font-bold text-slate-700 dark:text-slate-200">{{ term.document_hash || term.documentHash || '—' }}</span>
            </div>
            <div v-if="term.signer_ip" class="font-mono text-[10px] text-slate-400 dark:text-slate-500">
              IP Autenticado: {{ term.signer_ip }}
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button
              v-if="term.status === 'pending'"
              type="button"
              :disabled="signingId === term.id"
              class="px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold uppercase tracking-wider shadow-md shadow-brand/20 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
              @click="openSignModal(term)"
            >
              <span>✍️</span>
              <span>{{ signingId === term.id ? 'Gravando Selo...' : 'Assinar Digitalmente' }}</span>
            </button>

            <button
              type="button"
              :disabled="verifyingId === term.id"
              class="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-all shadow-2xs cursor-pointer flex items-center gap-1.5"
              @click="handleVerify(term.id)"
            >
              <span>🔍</span>
              <span>{{ verifyingId === term.id ? 'Auditando...' : 'Verificar Autenticidade' }}</span>
            </button>
          </div>
        </div>

        <!-- Official Notarization / Verification Report -->
        <div
          v-if="verificationResult[term.id]"
          class="p-4 rounded-2xl border text-xs font-mono space-y-2 shadow-sm transition-all animate-in fade-in duration-200"
          :class="
            isTamperedOrInvalid(verificationResult[term.id])
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200'
              : verificationResult[term.id].signatureValid
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-200'
                : 'bg-slate-100 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
          "
        >
          <div class="font-bold text-sm flex items-center gap-2">
            <template v-if="isTamperedOrInvalid(verificationResult[term.id])">
              <span>❌ ALERTA: DIVERGÊNCIA OU ASSINATURA INVÁLIDA</span>
            </template>
            <template v-else-if="verificationResult[term.id].signatureValid">
              <span>✓ CERTIFICADO DIGITAL: ASSINATURA E DOCUMENTO ÍNTEGROS</span>
            </template>
            <template v-else>
              <span>✓ Integridade Verificada (Aguardando assinatura do colaborador)</span>
            </template>
          </div>
          <div class="truncate text-[11px] text-slate-600 dark:text-slate-400">
            Algoritmo Criptográfico: <span class="font-bold text-slate-900 dark:text-white">{{ verificationResult[term.id].algorithm }}</span>
          </div>
          <div v-if="verificationResult[term.id].signatureHash" class="truncate text-[11px] text-slate-700 dark:text-slate-300">
            Selo HMAC: <span class="font-bold">{{ verificationResult[term.id].signatureHash }}</span>
          </div>
          <div v-if="auditProofByTerm[term.id]" class="truncate text-[11px] text-emerald-800 dark:text-emerald-300">
            Registro Imutável Hash-Chain #{{ auditProofByTerm[term.id].seq }}: {{ auditProofByTerm[term.id].entryHash }}
          </div>
        </div>
      </article>
    </div>

    <!-- Legal Signature Confirmation Modal -->
    <div
      v-if="termToSignModal"
      class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center text-xl font-black">
              ✍️
            </div>
            <div>
              <h3 class="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                Assinatura Digital de Termo CLT
              </h3>
              <p class="text-xs text-slate-400 font-mono">
                Hash: {{ (termToSignModal.document_hash || termToSignModal.documentHash || '').slice(0, 16) }}…
              </p>
            </div>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg font-black p-1.5 rounded-lg cursor-pointer"
            @click="termToSignModal = null"
          >
            ✕
          </button>
        </div>

        <div class="space-y-4 text-xs">
          <p class="text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
            Ao assinar este documento, você declara que recebeu os equipamentos listados em perfeito estado de funcionamento e conservação, assumindo sua guarda e zelo pessoal conforme as disposições do Artigo 462 §1º da Consolidação das Leis do Trabalho (CLT).
          </p>

          <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Equipamentos Vinculados:
            </span>
            <div class="space-y-1">
              <div
                v-for="(item, idx) in (termToSignModal.assets_snapshot || termToSignModal.assetsSnapshot || [])"
                :key="idx"
                class="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"
              >
                <span class="text-brand">●</span>
                <span>{{ item.internalId || item.internal_id }} — {{ item.model }}</span>
              </div>
            </div>
          </div>

          <label class="flex items-start gap-3 p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/60 cursor-pointer select-none">
            <input
              v-model="signAgreed"
              type="checkbox"
              class="w-4 h-4 rounded text-brand focus:ring-brand mt-0.5 cursor-pointer"
            />
            <span class="text-xs text-slate-800 dark:text-slate-200 font-medium leading-relaxed">
              Li e concordo integralmente com as condições do Termo de Responsabilidade e autorizo a gravação do selo criptográfico HMAC-SHA256 vinculado ao meu usuário e IP.
            </span>
          </label>
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            class="text-xs font-bold px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            @click="termToSignModal = null"
          >
            Cancelar
          </button>
          <button
            type="button"
            :disabled="!signAgreed || signingId"
            class="text-xs font-bold px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white uppercase tracking-wider transition-all shadow-md shadow-brand/20 disabled:opacity-40 cursor-pointer"
            @click="confirmSign"
          >
            {{ signingId ? 'Gravando Assinatura...' : 'Confirmar e Assinar Termo' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
