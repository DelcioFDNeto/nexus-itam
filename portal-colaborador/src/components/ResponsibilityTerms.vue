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
    return { label: 'Assinado Digitalmente', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (status === 'revoked') {
    return { label: 'Termo Revogado', cls: 'bg-red-50 text-red-700 border-red-200' };
  }
  return { label: 'Aguardando Assinatura', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
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
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
      <div>
        <h2 class="text-lg font-extrabold tracking-tight text-slate-900">
          Termos de Custódia & Conformidade CLT
        </h2>
        <p class="text-xs text-slate-500">
          Instrumentos jurídicos de cessão de equipamentos em conformidade com o Artigo 462 da CLT.
        </p>
      </div>
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold self-start sm:self-auto">
        <span>Assinatura Digital Certificada</span>
      </span>
    </div>

    <!-- Error Alert -->
    <div
      v-if="actionError"
      class="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700"
    >
      {{ actionError }}
    </div>

    <!-- Empty State -->
    <div
      v-if="terms.length === 0"
      class="station-panel p-10 text-center space-y-3"
    >
      <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-xl">
        📋
      </div>
      <div>
        <h3 class="text-sm font-bold text-slate-800">Nenhum termo pendente</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">
          Não há termos de responsabilidade aguardando assinatura para o seu usuário.
        </p>
      </div>
    </div>

    <!-- Terms List -->
    <div v-else class="space-y-4">
      <article
        v-for="term in terms"
        :key="term.id"
        class="station-panel p-6 space-y-4 border-l-4"
        :class="term.status === 'signed' ? 'border-l-emerald-500' : 'border-l-amber-500'"
      >
        <!-- Header Ribbon -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border shadow-2xs"
              :class="getStatusBadge(term.status).cls"
            >
              {{ getStatusBadge(term.status).label }}
            </span>
            <span class="font-mono text-xs px-2.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              Tipo: {{ term.term_type === 'entrega' ? 'Entrega de Equipamento' : term.term_type }}
            </span>
          </div>

          <div class="text-xs text-slate-500 font-sans">
            <span v-if="term.signed_at" class="text-emerald-700 font-medium">
              ✓ Assinado em {{ formatPtDate(term.signed_at) }}
            </span>
            <span v-else class="text-amber-700 font-semibold">
              ⚠️ Assinatura pendente
            </span>
          </div>
        </div>

        <!-- Legal Statement Clause -->
        <div class="bg-slate-50/80 p-4 rounded-xl border border-slate-200/90 text-xs text-slate-700 leading-relaxed font-sans space-y-1">
          <p class="font-bold text-slate-900 uppercase text-[10px] tracking-wider">
            Declaração de Responsabilidade (Art. 462 da CLT)
          </p>
          <p>{{ term.legal_clause }}</p>
        </div>

        <!-- Attached Hardware Snapshot -->
        <div class="space-y-1.5">
          <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Equipamentos Descritos no Instrumento:
          </p>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="(item, idx) in term.assets_snapshot"
              :key="idx"
              class="font-mono text-xs font-semibold px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-800 shadow-2xs flex items-center gap-2"
            >
              <span class="font-black text-brand">{{ item.internalId }}</span>
              <span>— {{ item.model }}</span>
              <span v-if="item.serialNumber" class="text-slate-400 font-normal">
                (S/N: {{ item.serialNumber }})
              </span>
            </span>
          </div>
        </div>

        <!-- Verification & Signature Actions -->
        <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-0.5 max-w-md">
            <div class="font-mono text-[11px] text-slate-500 truncate" title="Hash criptográfico SHA-256 do documento">
              Hash SHA-256: <span class="font-bold text-slate-700">{{ term.document_hash }}</span>
            </div>
            <div v-if="term.signer_ip" class="font-mono text-[10px] text-slate-400">
              IP Autenticado: {{ term.signer_ip }}
            </div>
          </div>

          <div class="flex items-center gap-2.5">
            <button
              v-if="term.status === 'pending'"
              type="button"
              :disabled="signingId === term.id"
              class="px-4 py-2 rounded-xl bg-gradient-to-r from-brand to-indigo-600 hover:from-brand-dark hover:to-indigo-700 text-white text-xs font-bold uppercase tracking-wider shadow-md shadow-brand/20 disabled:opacity-50 transition-all"
              @click="handleSign(term.id)"
            >
              {{ signingId === term.id ? 'Gravando Selo Digital...' : 'Assinar Digitalmente' }}
            </button>

            <button
              type="button"
              :disabled="verifyingId === term.id"
              class="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50 transition-all shadow-2xs"
              @click="handleVerify(term.id)"
            >
              {{ verifyingId === term.id ? 'Auditando...' : 'Verificar Autenticidade' }}
            </button>
          </div>
        </div>

        <!-- Official Notarization / Verification Report -->
        <div
          v-if="verificationResult[term.id]"
          class="p-4 rounded-xl border text-xs font-mono space-y-1.5 shadow-2xs transition-all animate-in fade-in duration-200"
          :class="
            isTamperedOrInvalid(verificationResult[term.id])
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : verificationResult[term.id].signatureValid
                ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                : 'bg-slate-100 border-slate-300 text-slate-800'
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
          <div class="truncate text-[11px] text-slate-600">
            Algoritmo Criptográfico: <span class="font-bold">{{ verificationResult[term.id].algorithm }}</span>
          </div>
          <div v-if="verificationResult[term.id].signatureHash" class="truncate text-[11px] text-slate-700">
            Selo HMAC: <span class="font-bold">{{ verificationResult[term.id].signatureHash }}</span>
          </div>
          <div v-if="auditProofByTerm[term.id]" class="truncate text-[11px] text-emerald-800">
            Registro Imutável Hash-Chain #{{ auditProofByTerm[term.id].seq }}: {{ auditProofByTerm[term.id].entryHash }}
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
