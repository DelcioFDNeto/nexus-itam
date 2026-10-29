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

function formatPtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('pt-BR');
}

function getStatusBadge(status) {
  if (status === 'signed') {
    return { label: 'Assinado Digitalmente', cls: 'bg-emerald-100 text-emerald-800' };
  }
  if (status === 'revoked') {
    return { label: 'Termo Revogado', cls: 'bg-red-100 text-red-800' };
  }
  return { label: 'Aguardando Assinatura', cls: 'bg-amber-100 text-amber-800' };
}

function isTamperedOrInvalid(res) {
  if (!res) return false;
  if (res.documentIntact === false) return true;
  if (res.status === 'signed' && !res.signatureValid) return true;
  return false;
}

async function handleSign(termId) {
  actionError.value = '';
  signingId.value = termId;
  try {
    const signRes = await portalApi.signTerm(termId);
    if (signRes?.auditProof) {
      auditProofByTerm.value[termId] = signRes.auditProof;
    }
    const check = await portalApi.verifyTermIntegrity(termId);
    verificationResult.value[termId] = check;
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
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="font-mono text-[11px] uppercase tracking-widest text-indigo-600 font-semibold">
          API 3 (REST) • /api/v1/compliance/terms • HMAC-SHA256
        </p>
        <h2 class="text-lg font-bold tracking-tight text-slate-900">
          Passaporte Jurídico & Termos de Custódia CLT
        </h2>
      </div>
    </div>

    <div
      v-if="actionError"
      class="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
    >
      {{ actionError }}
    </div>

    <div
      v-if="terms.length === 0"
      class="station-panel p-8 text-center text-sm text-slate-500"
    >
      Nenhum termo de responsabilidade emitido para o seu perfil.
    </div>

    <div v-else class="space-y-3">
      <article
        v-for="term in terms"
        :key="term.id"
        class="station-panel p-5 space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded"
              :class="getStatusBadge(term.status).cls"
            >
              {{ getStatusBadge(term.status).label }}
            </span>
            <span class="mono-tag">Tipo: {{ term.term_type }}</span>
          </div>
          <div class="text-xs text-slate-400 font-mono">
            <span>Emitido por {{ term.issued_by }}</span>
            <span v-if="term.signed_at"> • Assinado em {{ formatPtDate(term.signed_at) }}</span>
          </div>
        </div>

        <p class="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200/70">
          {{ term.legal_clause }}
        </p>

        <div class="flex flex-wrap gap-2">
          <span
            v-for="(item, idx) in term.assets_snapshot"
            :key="idx"
            class="mono-tag"
          >
            {{ item.internalId }} — {{ item.model }}
            <template v-if="item.serialNumber"> (S/N: {{ item.serialNumber }})</template>
          </span>
        </div>

        <div class="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div class="space-y-0.5 max-w-md">
            <div class="font-mono text-[11px] text-slate-500 truncate">
              SHA-256 Doc: {{ term.document_hash }}
            </div>
            <div v-if="term.signer_ip" class="font-mono text-[10px] text-slate-400">
              IP Registrado: {{ term.signer_ip }}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="term.status === 'pending'"
              type="button"
              :disabled="signingId === term.id"
              class="px-4 py-2 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-dark disabled:opacity-50 transition-colors"
              @click="handleSign(term.id)"
            >
              {{ signingId === term.id ? 'Selando HMAC-SHA256...' : 'Assinar Termo Digitalmente' }}
            </button>

            <button
              type="button"
              :disabled="verifyingId === term.id"
              class="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
              @click="handleVerify(term.id)"
            >
              {{ verifyingId === term.id ? 'Verificando...' : 'Auditar Criptografia' }}
            </button>
          </div>
        </div>

        <div
          v-if="verificationResult[term.id]"
          class="p-3 rounded-lg border text-xs font-mono space-y-1"
          :class="
            isTamperedOrInvalid(verificationResult[term.id])
              ? 'bg-red-50 border-red-300 text-red-900'
              : verificationResult[term.id].signatureValid
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                : 'bg-slate-100 border-slate-300 text-slate-800'
          "
        >
          <div class="font-bold">
            <template v-if="isTamperedOrInvalid(verificationResult[term.id])">
              ✗ ALERTA CRIPTOGRÁFICO: ADULTERAÇÃO OU ASSINATURA INVÁLIDA DETECTADA
            </template>
            <template v-else-if="verificationResult[term.id].signatureValid">
              ✓ SELO HMAC-SHA256 AUTÊNTICO E DOCUMENTO ÍNTEGRO
            </template>
            <template v-else>
              ✓ Hash SHA-256 íntegro ({{
                verificationResult[term.id].status === 'revoked'
                  ? 'termo revogado'
                  : 'aguardando assinatura do colaborador'
              }})
            </template>
          </div>
          <div class="truncate">Algoritmo: {{ verificationResult[term.id].algorithm }}</div>
          <div v-if="verificationResult[term.id].signatureHash" class="truncate">
            Assinatura HMAC: {{ verificationResult[term.id].signatureHash }}
          </div>
          <div v-if="auditProofByTerm[term.id]" class="truncate text-[11px] opacity-85">
            Bloco Hash-Chain #{{ auditProofByTerm[term.id].seq }}: {{ auditProofByTerm[term.id].entryHash }}
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
