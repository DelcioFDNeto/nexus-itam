<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useModalDialog } from '../composables/useModalDialog';
import PortalIcon from './PortalIcon.vue';

const props = defineProps({
  assets: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['report-issue', 'retry']);

const searchQuery = ref('');
const selectedCategory = ref('all');
const selectedAsset = ref(null);
const copiedTag = ref('');
const verifiedAssets = ref(new Map());
const verificationToast = ref('');
const closeModalBtnRef = ref(null);
const modalPanelRef = ref(null);
const custodyHeadingRef = ref(null);

let copiedTimer = null;
let toastTimer = null;

const { requestClose: requestModalClose, handleBackdropClick } = useModalDialog({
  isOpen: computed(() => Boolean(selectedAsset.value)),
  dialogRef: modalPanelRef,
  initialFocusRef: closeModalBtnRef,
  fallbackFocusRef: custodyHeadingRef,
  onClose: () => {
    selectedAsset.value = null;
  },
});

function getDeviceIconName(type = '') {
  const t = (type || '').toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return 'laptop';
  if (t.includes('monit') || t.includes('tela')) return 'monitor';
  if (t.includes('phone') || t.includes('celular') || t.includes('smart')) return 'smartphone';
  if (t.includes('desk') || t.includes('comp') || t.includes('serv')) return 'server';
  if (t.includes('imp') || t.includes('print') || t.includes('zebra')) return 'printer';
  return 'package';
}

function parseAssetValue(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).trim();
  if (str.includes(',')) {
    return parseFloat(str.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
  }
  return parseFloat(str.replace(/[^\d.-]/g, '')) || 0;
}

function formatCurrency(val) {
  const num = parseAssetValue(val);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

const totalValuation = computed(() => {
  return (props.assets || []).reduce(
    (acc, a) => acc + parseAssetValue(a.purchase_value ?? a.valor ?? a.purchaseValue ?? 0),
    0,
  );
});

const categories = computed(() => {
  const cats = new Set();
  (props.assets || []).forEach((a) => {
    if (a.type) cats.add(a.type);
  });
  return Array.from(cats);
});

const filteredAssets = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return (props.assets || []).filter((a) => {
    if (selectedCategory.value !== 'all') {
      const matchCat = (a.type || '').toLowerCase() === selectedCategory.value.toLowerCase();
      if (!matchCat) return false;
    }
    if (q) {
      const hay =
        `${a.internal_id || ''} ${a.model || ''} ${a.brand || ''} ${a.serial_number || ''} ${a.location || ''} ${a.type || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

async function copyToClipboard(text, id) {
  try {
    await navigator.clipboard.writeText(text);
    copiedTag.value = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      if (copiedTag.value === id) copiedTag.value = '';
    }, 2000);
  } catch {
    // Fallback silencioso
  }
}

function handleConfirmIntegrity(asset) {
  const assetKey = asset.id || asset.internal_id || asset.internalId;
  const now = new Date();
  const timeStr = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  verifiedAssets.value.set(assetKey, timeStr);
  const tag = asset.internal_id || asset.internalId || 'Ativo';
  verificationToast.value = `Posse e integridade de ${tag} confirmadas com sucesso. Selo digital registrado.`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    verificationToast.value = '';
  }, 4500);
}

function openAssetModal(asset) {
  selectedAsset.value = asset;
}

function reportIssueFromModal() {
  const target = selectedAsset.value;
  requestModalClose({ force: true });
  if (target) {
    emit('report-issue', target);
  }
}

onBeforeUnmount(() => {
  clearTimeout(copiedTimer);
  clearTimeout(toastTimer);
});

function resolveSpecs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return { info: raw };
    }
  }
  return {};
}

function parseRamUnit(numStr, unit) {
  const num = parseFloat(String(numStr).replace(',', '.'));
  if (Number.isNaN(num) || num <= 0) return null;
  const u = (unit || 'GB').toUpperCase();
  if (u === 'TB') return Math.round(num * 1024);
  if (u === 'MB') return Math.max(1, Math.round(num / 1024));
  return Math.round(num);
}

function parseRamGb(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const explicitVal = specs.ram ?? specs.RAM ?? specs.memoria ?? specs.Memória ?? specs.memory;
  if (typeof explicitVal === 'number' && !Number.isNaN(explicitVal) && explicitVal > 0) {
    return explicitVal;
  }
  if (typeof explicitVal === 'string' && explicitVal.trim()) {
    const unitMatch = explicitVal.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i);
    if (unitMatch) return parseRamUnit(unitMatch[1], unitMatch[2]);
    const bareNum = explicitVal.trim().match(/^(\d+)$/);
    if (bareNum) {
      const parsed = parseInt(bareNum[1], 10);
      return parsed > 0 ? parsed : null;
    }
  }
  const infoText = specs.info ? String(specs.info) : '';
  if (infoText) {
    const beforeRam = infoText.match(
      /(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\s*(?:de\s*)?(?:RAM|Mem[oó]ria)\b/i,
    );
    if (beforeRam) return parseRamUnit(beforeRam[1], beforeRam[2]);
    const afterRam = infoText.match(
      /(?:RAM|Mem[oó]ria)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i,
    );
    if (afterRam) return parseRamUnit(afterRam[1], afterRam[2]);
  }
  return null;
}

function parseDiskCap(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const explicitVal =
    specs.storage ??
    specs.disco ??
    specs.ssd ??
    specs.Disco ??
    specs.SSD ??
    specs.hd ??
    specs.armazenamento ??
    '';
  if (typeof explicitVal === 'number' && !Number.isNaN(explicitVal) && explicitVal > 0) {
    return `${explicitVal} GB`;
  }
  if (typeof explicitVal === 'string' && explicitVal.trim()) {
    return explicitVal.trim();
  }
  const infoText = specs.info ? String(specs.info) : '';
  if (infoText) {
    const diskMatch = infoText.match(
      /(\d+(?:[.,]\d+)?\s*(?:GB|TB)\s*(?:SSD|NVMe|HDD|HD)|(?:SSD|NVMe|HDD|HD)\s*\d+(?:[.,]\d+)?\s*(?:GB|TB))/i,
    );
    if (diskMatch) return diskMatch[0].trim();
  }
  return '';
}

function parseCpuLabel(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const explicitVal =
    specs.cpu ?? specs.CPU ?? specs.processador ?? specs.Processador ?? specs.processor ?? '';
  return explicitVal ? String(explicitVal).trim() : '';
}
</script>

<template>
  <section class="space-y-6">
    <!-- Executive Top Header -->
    <div
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-4"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
          <h2
            ref="custodyHeadingRef"
            tabindex="-1"
            class="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa] focus:outline-none"
          >
            Passaporte digital de ativos sob custódia
          </h2>
        </div>
        <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl leading-relaxed">
          Instrumento oficial de gestão patrimonial individualizada. Ativos vinculados ao seu termo
          de responsabilidade civil e trabalhista CLT (Artigo 462 §1º).
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
        <span
          class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 dark:bg-zinc-900 text-[#fafafa] text-xs font-mono font-semibold shadow-sm border border-slate-800 dark:border-zinc-700"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400" />
          <span class="tabular-nums">{{ assets.length }}</span>
          <span class="text-slate-200 font-sans font-normal">
            {{ assets.length === 1 ? 'dispositivo ativo' : 'dispositivos ativos' }}
          </span>
        </span>
      </div>
    </div>

    <!-- Verification Toast Banner -->
    <div
      v-if="verificationToast"
      role="status"
      aria-live="polite"
      class="p-4 rounded-2xl bg-emerald-700 dark:bg-emerald-800 text-white text-xs font-medium flex items-center justify-between gap-3 shadow-lg animate-slide-down border border-emerald-500/40"
    >
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center shrink-0">
          <PortalIcon name="check" :size="16" />
        </div>
        <div class="min-w-0">
          <p class="font-semibold text-white text-xs">Vistoria registrada</p>
          <p class="text-emerald-50 text-xs break-words">{{ verificationToast }}</p>
        </div>
      </div>
      <button
        type="button"
        class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center text-white hover:bg-white/15 active:scale-95 rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Fechar aviso"
        @click="verificationToast = ''"
      >
        <PortalIcon name="x" :size="16" />
      </button>
    </div>

    <!-- Executive Metrics Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3.5">
      <!-- Total de Ativos -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-brand-ring">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
            Custódia direta
          </span>
          <div
            class="w-8 h-8 rounded-xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0"
          >
            <PortalIcon name="package" :size="16" />
          </div>
        </div>
        <div class="mt-3 min-w-0">
          <p class="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight tabular-nums">
            {{ assets.length }}
          </p>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">
            {{ assets.length === 1 ? 'Equipamento vinculado' : 'Equipamentos vinculados' }}
          </p>
        </div>
      </div>

      <!-- Patrimônio em Posse -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-emerald-600 dark:border-l-emerald-400">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
            Patrimônio declarado
          </span>
          <div
            class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0"
          >
            <PortalIcon name="wallet" :size="16" />
          </div>
        </div>
        <div class="mt-3 min-w-0">
          <p
            class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#fafafa] tabular-nums tracking-tight truncate"
          >
            {{ formatCurrency(totalValuation) }}
          </p>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">
            Valor de reposição CLT
          </p>
        </div>
      </div>

      <!-- Categorias -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-sky-600 dark:border-l-sky-400">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
            Diversidade de frota
          </span>
          <div
            class="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0"
          >
            <PortalIcon name="tag" :size="16" />
          </div>
        </div>
        <div class="mt-3 min-w-0">
          <p class="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight tabular-nums">
            {{ categories.length }}
          </p>
          <p class="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">
            {{ categories.length === 1 ? 'Categoria de hardware' : 'Categorias de hardware' }}
          </p>
        </div>
      </div>

      <!-- Vistorias Concluídas -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-cyan-600 dark:border-l-cyan-400">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
            Integridade validada
          </span>
          <div
            class="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0"
          >
            <PortalIcon name="shield-check" :size="16" />
          </div>
        </div>
        <div class="mt-3 min-w-0">
          <div class="flex items-baseline gap-1.5 tabular-nums">
            <span class="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">
              {{ verifiedAssets.size }}
            </span>
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">
              / {{ assets.length }}
            </span>
          </div>
          <div class="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              class="bg-cyan-600 dark:bg-cyan-400 h-full rounded-full transition-[width] duration-500"
              :style="{ width: assets.length ? `${(verifiedAssets.size / assets.length) * 100}%` : '0%' }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div
      class="station-panel p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3"
    >
      <!-- Search Input -->
      <div class="relative flex-1 min-w-0">
        <label for="asset-search-input" class="sr-only">Buscar equipamentos</label>
        <span
          class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
        >
          <PortalIcon name="search" :size="16" />
        </span>
        <input
          id="asset-search-input"
          v-model="searchQuery"
          name="assetSearch"
          type="text"
          placeholder="Buscar por tag patrimonial, modelo, marca ou serial…"
          class="w-full min-h-[44px] pl-10 pr-11 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50/70 dark:bg-zinc-900 text-xs sm:text-sm text-slate-900 dark:text-[#fafafa] placeholder-slate-500 dark:placeholder-slate-400 focus:border-brand-ring focus:bg-white dark:focus:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring transition-colors"
        />
        <button
          v-if="searchQuery.trim()"
          type="button"
          class="icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          aria-label="Limpar busca"
          @click="searchQuery = ''"
        >
          <PortalIcon name="x" :size="16" />
        </button>
      </div>

      <!-- Category Filter Pills -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
        <button
          type="button"
          :aria-pressed="selectedCategory === 'all'"
          class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold active:scale-[0.98] transition-colors shrink-0 cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          :class="
            selectedCategory === 'all'
              ? 'bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] shadow-sm'
              : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-zinc-700'
          "
          @click="selectedCategory = 'all'"
        >
          Todos ({{ assets.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          :aria-pressed="selectedCategory === cat"
          class="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold active:scale-[0.98] transition-colors shrink-0 inline-flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          :class="
            selectedCategory === cat
              ? 'bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] shadow-sm'
              : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-zinc-700'
          "
          @click="selectedCategory = cat"
        >
          <PortalIcon :name="getDeviceIconName(cat)" :size="16" />
          <span>{{ cat }}</span>
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-if="error && !loading && assets.length === 0"
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
          Falha ao carregar equipamentos
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

    <!-- Loading Skeleton State -->
    <div
      v-else-if="loading && assets.length === 0"
      role="status"
      aria-label="Carregando equipamentos sob custódia"
      class="grid gap-5 md:grid-cols-2"
    >
      <div v-for="n in 2" :key="n" class="station-panel p-6 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-slate-200 dark:bg-zinc-800 animate-pulse" />
            <div class="space-y-2">
              <div class="w-24 h-5 rounded-lg bg-slate-200 dark:bg-zinc-800 animate-pulse" />
              <div class="w-32 h-4 rounded bg-slate-200 dark:bg-zinc-800 animate-pulse" />
            </div>
          </div>
          <div class="w-20 h-6 rounded-full bg-slate-200 dark:bg-zinc-800 animate-pulse" />
        </div>
        <div class="w-3/4 h-5 rounded bg-slate-200 dark:bg-zinc-800 animate-pulse" />
        <div class="h-28 rounded-xl bg-slate-100 dark:bg-zinc-900 animate-pulse" />
        <span class="sr-only">Carregando passaportes digitais de custódia…</span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredAssets.length === 0" class="station-panel p-12 text-center space-y-4">
      <div
        class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-300 mx-auto flex items-center justify-center"
      >
        <PortalIcon name="package" :size="24" />
      </div>
      <div class="max-w-md mx-auto">
        <h3 class="text-base font-bold text-slate-900 dark:text-[#fafafa]">
          {{
            searchQuery.trim()
              ? 'Nenhum equipamento coincide com a busca'
              : 'Nenhum equipamento registrado em custódia'
          }}
        </h3>
        <p class="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
          {{
            searchQuery.trim()
              ? 'Tente buscar por termos mais genéricos ou limpe os filtros de categoria.'
              : 'Caso você tenha recebido novos computadores, notebooks ou periféricos corporativos e eles não constem aqui, contate o suporte de TI para a emissão do termo de responsabilidade.'
          }}
        </p>
        <button
          v-if="searchQuery.trim() || selectedCategory !== 'all'"
          type="button"
          class="mt-4 min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] text-xs font-semibold hover:bg-brand hover:text-brand-fg dark:hover:bg-brand dark:hover:text-brand-fg active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          @click="
            searchQuery = '';
            selectedCategory = 'all';
          "
        >
          Limpar filtros de busca
        </button>
      </div>
    </div>

    <!-- Assets Grid: Digital Passport Cards -->
    <div v-else class="grid gap-5 md:grid-cols-2">
      <article
        v-for="asset in filteredAssets"
        :key="asset.id || asset.internal_id || asset.internalId"
        class="station-panel station-panel-hover p-6 flex flex-col justify-between gap-5 relative group cert-guilloche-bg min-w-0"
      >
        <div class="space-y-4 min-w-0">
          <!-- Passport Top Header Ribbon -->
          <div
            class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 pb-3.5"
          >
            <div class="flex items-start gap-3 min-w-0">
              <span
                class="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 group-hover:bg-brand/10 group-hover:text-brand-text-light dark:group-hover:text-brand-text-dark transition-colors shrink-0"
              >
                <PortalIcon :name="getDeviceIconName(asset.type)" :size="20" />
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-1 flex-wrap">
                  <span
                    class="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-zinc-800 text-[#fafafa] border border-slate-700/60 dark:border-zinc-700 shadow-sm break-all"
                  >
                    {{ asset.internal_id || asset.internalId }}
                  </span>
                  <button
                    type="button"
                    class="icon-btn min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:text-brand-text-light dark:hover:text-brand-text-dark hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-95 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                    :title="
                      copiedTag === (asset.internal_id || asset.internalId)
                        ? 'Copiado!'
                        : 'Copiar tag patrimonial'
                    "
                    :aria-label="
                      copiedTag === (asset.internal_id || asset.internalId)
                        ? 'Tag patrimonial copiada'
                        : `Copiar tag patrimonial ${asset.internal_id || asset.internalId}`
                    "
                    @click="
                      copyToClipboard(
                        asset.internal_id || asset.internalId,
                        asset.internal_id || asset.internalId,
                      )
                    "
                  >
                    <PortalIcon
                      :name="
                        copiedTag === (asset.internal_id || asset.internalId) ? 'check' : 'copy'
                      "
                      :size="16"
                    />
                  </button>
                </div>
                <span
                  class="text-xs font-semibold text-slate-600 dark:text-slate-300 block mt-0.5 break-words"
                >
                  {{ asset.type || 'Equipamento' }} • {{ asset.brand || 'Corporativo' }}
                </span>
              </div>
            </div>

            <!-- Status & Verification Stamp -->
            <div class="flex flex-col items-end gap-1.5 shrink-0">
              <span
                class="text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize border"
                :class="
                  asset.status === 'Em Uso' || asset.status === 'in_use'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                    : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25'
                "
              >
                {{ asset.status === 'in_use' ? 'Em uso ativo' : asset.status || 'Ativo' }}
              </span>
              <span
                v-if="verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)"
                class="text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1"
              >
                <PortalIcon name="check-circle" :size="14" />
                <span>
                  Vistoriado {{ verifiedAssets.get(asset.id || asset.internal_id || asset.internalId) }}
                </span>
              </span>
            </div>
          </div>

          <!-- Model & Value -->
          <div class="min-w-0">
            <h3
              class="text-base sm:text-lg font-bold text-slate-900 dark:text-[#fafafa] group-hover:text-brand-text-light dark:group-hover:text-brand-text-dark transition-colors leading-snug break-words"
            >
              {{ asset.model || 'Modelo não especificado' }}
            </h3>
            <p
              v-if="asset.purchase_value || asset.purchaseValue || asset.valor"
              class="text-xs font-medium text-slate-600 dark:text-slate-300 mt-1"
            >
              Valor de guarda:
              <span class="font-semibold text-slate-900 dark:text-[#fafafa] tabular-nums">
                {{ formatCurrency(asset.purchase_value ?? asset.purchaseValue ?? asset.valor) }}
              </span>
            </p>
          </div>

          <!-- Hardware Specifications Gauges -->
          <div
            class="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50/90 dark:bg-zinc-900/80 border border-slate-200/80 dark:border-zinc-800"
          >
            <!-- CPU -->
            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <PortalIcon name="cpu" :size="14" />
                <span>Processador</span>
              </div>
              <p
                class="font-mono text-xs font-semibold truncate"
                :class="
                  parseCpuLabel(asset.specs)
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-300 font-sans font-normal'
                "
                :title="parseCpuLabel(asset.specs) || 'Não informado'"
              >
                {{ parseCpuLabel(asset.specs) || 'Não informado' }}
              </p>
            </div>

            <!-- RAM -->
            <div class="space-y-1 min-w-0">
              <div
                class="flex items-center justify-between gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                <span class="inline-flex items-center gap-1.5 truncate">
                  <PortalIcon name="gauge" :size="14" />
                  <span>Memória RAM</span>
                </span>
                <span
                  v-if="parseRamGb(asset.specs) !== null"
                  class="font-mono text-brand-text-light dark:text-brand-text-dark tabular-nums shrink-0"
                >
                  {{ parseRamGb(asset.specs) }} GB
                </span>
                <span
                  v-else
                  class="text-slate-600 dark:text-slate-300 font-normal shrink-0"
                >
                  —
                </span>
              </div>
              <div class="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div
                  class="bg-brand h-full rounded-full"
                  :style="{
                    width:
                      parseRamGb(asset.specs) !== null
                        ? `${Math.min(100, (parseRamGb(asset.specs) / 32) * 100)}%`
                        : '0%',
                  }"
                />
              </div>
            </div>

            <!-- Storage -->
            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <PortalIcon name="hard-drive" :size="14" />
                <span>Armazenamento</span>
              </div>
              <p
                class="font-mono text-xs font-semibold truncate"
                :class="
                  parseDiskCap(asset.specs)
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-300 font-sans font-normal'
                "
                :title="parseDiskCap(asset.specs) || 'Não informado'"
              >
                {{ parseDiskCap(asset.specs) || 'Não informado' }}
              </p>
            </div>

            <!-- Filial / Localização -->
            <div class="space-y-1 min-w-0">
              <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <PortalIcon name="map-pin" :size="14" />
                <span>Unidade / Filial</span>
              </div>
              <p class="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {{ asset.location || 'Não informada' }}
              </p>
            </div>
          </div>

          <!-- Serial & CLT Digital Stamp Ribbon -->
          <div
            class="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs border-t border-slate-100 dark:border-zinc-800"
          >
            <div class="flex items-center gap-1 font-mono text-slate-600 dark:text-slate-300 min-w-0">
              <span class="font-sans font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                S/N:
              </span>
              <span class="font-semibold text-slate-900 dark:text-[#fafafa] break-all">
                {{ asset.serial_number || asset.serialNumber || 'N/A' }}
              </span>
              <button
                v-if="asset.serial_number || asset.serialNumber"
                type="button"
                class="icon-btn min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:text-brand-text-light dark:hover:text-brand-text-dark hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
                title="Copiar número de série"
                :aria-label="`Copiar número de série ${asset.serial_number || asset.serialNumber}`"
                @click="
                  copyToClipboard(
                    asset.serial_number || asset.serialNumber,
                    `sn-${asset.internal_id || asset.internalId}`,
                  )
                "
              >
                <PortalIcon
                  :name="
                    copiedTag === `sn-${asset.internal_id || asset.internalId}` ? 'check' : 'copy'
                  "
                  :size="16"
                />
              </button>
            </div>

            <!-- Selo CLT HMAC Stamp -->
            <div
              class="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border shrink-0"
              :class="
                verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-zinc-700'
              "
            >
              <PortalIcon name="shield-check" :size="14" />
              <span>CLT Art. 462 • HMAC-SHA256</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div
          class="pt-3.5 border-t border-slate-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2"
        >
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="min-h-[44px] text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              @click="openAssetModal(asset)"
            >
              Ver ficha técnica
            </button>
            <button
              type="button"
              class="min-h-[44px] text-xs font-semibold px-3.5 py-2 rounded-xl border active:scale-[0.98] transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
              :class="
                verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-400 dark:border-emerald-700'
                  : 'border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-200'
              "
              title="Confirmar que o equipamento se encontra íntegro sob sua responsabilidade física"
              @click="handleConfirmIntegrity(asset)"
            >
              <PortalIcon
                v-if="verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)"
                name="check"
                :size="16"
              />
              <span>
                {{
                  verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)
                    ? 'Posse confirmada'
                    : 'Confirmar posse'
                }}
              </span>
            </button>
          </div>

          <button
            type="button"
            class="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-slate-900 dark:bg-[#fafafa] text-white dark:text-[#09090b] hover:bg-brand hover:text-brand-fg dark:hover:bg-brand dark:hover:text-brand-fg active:scale-[0.98] transition-colors shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="emit('report-issue', asset)"
          >
            <span>Abrir chamado</span>
            <PortalIcon name="chevron-right" :size="16" />
          </button>
        </div>
      </article>
    </div>

    <!-- Asset Detail Modal (Ficha Técnica do Passaporte) -->
    <div
      v-if="selectedAsset"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-modal-title"
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
            <span
              class="p-3 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 shrink-0"
            >
              <PortalIcon :name="getDeviceIconName(selectedAsset.type)" :size="24" />
            </span>
            <div class="min-w-0">
              <span
                class="font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg bg-slate-900 dark:bg-zinc-800 text-[#fafafa] border border-slate-700/60 dark:border-zinc-700 inline-block break-all"
              >
                {{ selectedAsset.internal_id || selectedAsset.internalId }}
              </span>
              <h3
                id="asset-modal-title"
                class="text-base sm:text-lg font-bold text-slate-900 dark:text-[#fafafa] mt-1 break-words"
              >
                {{ selectedAsset.model }}
              </h3>
            </div>
          </div>
          <button
            ref="closeModalBtnRef"
            type="button"
            class="icon-btn min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-95 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            aria-label="Fechar janela"
            @click="requestModalClose()"
          >
            <PortalIcon name="x" :size="18" />
          </button>
        </div>

        <div class="space-y-4 text-xs">
          <!-- Passport Attributes -->
          <div
            class="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-zinc-900/80 p-4 rounded-2xl border border-slate-200/80 dark:border-zinc-800"
          >
            <div class="min-w-0">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Tipo e categoria
              </span>
              <span class="font-semibold text-slate-900 dark:text-[#fafafa] mt-0.5 block break-words">
                {{ selectedAsset.type || 'Não informado' }}
              </span>
            </div>
            <div class="min-w-0">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Fabricante
              </span>
              <span class="font-semibold text-slate-900 dark:text-[#fafafa] mt-0.5 block break-words">
                {{ selectedAsset.brand || 'Não informado' }}
              </span>
            </div>
            <div class="min-w-0">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Número de série
              </span>
              <span class="font-mono font-semibold text-slate-900 dark:text-[#fafafa] mt-0.5 block break-all">
                {{ selectedAsset.serial_number || selectedAsset.serialNumber || 'Não informado' }}
              </span>
            </div>
            <div class="min-w-0">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
                Valor registrado
              </span>
              <span
                class="font-semibold text-emerald-700 dark:text-emerald-300 mt-0.5 block tabular-nums"
              >
                {{
                  selectedAsset.purchase_value ?? selectedAsset.purchaseValue ?? selectedAsset.valor
                    ? formatCurrency(
                        selectedAsset.purchase_value ??
                          selectedAsset.purchaseValue ??
                          selectedAsset.valor,
                      )
                    : 'Não informado'
                }}
              </span>
            </div>
          </div>

          <!-- Extended Technical Specs -->
          <div>
            <h4 class="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
              Especificações técnicas de hardware
            </h4>
            <div
              v-if="
                resolveSpecs(selectedAsset.specs) &&
                Object.keys(resolveSpecs(selectedAsset.specs)).length > 0
              "
              class="bg-slate-50 dark:bg-zinc-900/80 border border-slate-200/80 dark:border-zinc-800 rounded-2xl p-3.5 divide-y divide-slate-200/60 dark:divide-zinc-800"
            >
              <div
                v-for="(val, key) in resolveSpecs(selectedAsset.specs)"
                :key="key"
                class="py-2 flex items-center justify-between gap-3 text-xs"
              >
                <span class="font-semibold text-slate-600 dark:text-slate-300 shrink-0">{{ key }}</span>
                <span class="font-mono font-semibold text-slate-900 dark:text-[#fafafa] text-right break-all">
                  {{ val }}
                </span>
              </div>
            </div>
            <p v-else class="text-slate-600 dark:text-slate-300 italic py-2">
              Nenhuma especificação técnica adicional registrada pelo inventário.
            </p>
          </div>

          <!-- Legal Disclaimer -->
          <div
            class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-950 dark:text-amber-200 leading-relaxed"
          >
            <span class="font-semibold block mb-0.5">Responsabilidade legal CLT Art. 462 §1º:</span>
            O equipamento acima é de uso estritamente corporativo e de guarda pessoal intransferível.
            Havendo extravio, defeito ou furto, notifique imediatamente a equipe de TI por meio da
            Central de Chamados.
          </div>
        </div>

        <div
          class="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-100 dark:border-zinc-800"
        >
          <button
            type="button"
            class="min-h-[44px] text-xs font-semibold px-4 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="requestModalClose()"
          >
            Fechar ficha
          </button>
          <button
            type="button"
            class="min-h-[44px] text-xs font-semibold px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark border border-black/10 dark:border-white/15 active:scale-[0.98] text-brand-fg transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
            @click="reportIssueFromModal"
          >
            <span>Abrir chamado técnico</span>
            <PortalIcon name="chevron-right" :size="16" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
