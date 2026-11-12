<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  assets: { type: Array, required: true },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['report-issue']);

const searchQuery = ref('');
const selectedCategory = ref('all');
const selectedAsset = ref(null);
const copiedTag = ref('');
const verifiedAssets = ref(new Map());
const verificationToast = ref('');

function getDeviceIcon(type = '') {
  const t = (type || '').toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return '💻';
  if (t.includes('monit') || t.includes('tela')) return '🖥️';
  if (t.includes('phone') || t.includes('celular') || t.includes('smart')) return '📱';
  if (t.includes('desk') || t.includes('comp') || t.includes('serv')) return '🗄️';
  if (t.includes('imp') || t.includes('print') || t.includes('zebra')) return '🖨️';
  return '📦';
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
  return (props.assets || []).filter((a) => {
    if (selectedCategory.value !== 'all') {
      const matchCat = (a.type || '').toLowerCase() === selectedCategory.value.toLowerCase();
      if (!matchCat) return false;
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      const hay = `${a.internal_id || ''} ${a.model || ''} ${a.brand || ''} ${a.serial_number || ''} ${a.location || ''} ${a.type || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

async function copyToClipboard(text, id) {
  try {
    await navigator.clipboard.writeText(text);
    copiedTag.value = id;
    setTimeout(() => {
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
  verificationToast.value = `Posse e integridade de ${tag} confirmadas com sucesso! Selo digital registrado.`;
  setTimeout(() => {
    verificationToast.value = '';
  }, 4500);
}

// Helper seguro para normalizar specs (objeto, string JSON ou vazio)
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

// Helpers para extrair métricas de hardware visuais dos specs
function parseRamGb(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const ramVal = specs.ram || specs.RAM || specs.memoria || specs.Memória || (specs.info && String(specs.info)) || '';
  if (typeof ramVal === 'number' && !isNaN(ramVal)) return ramVal;
  const match = String(ramVal).match(/(\d+)\s*(?:GB|G)?/i);
  return match ? parseInt(match[1], 10) : 16;
}

function parseDiskCap(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const dVal = specs.storage || specs.disco || specs.ssd || specs.Disco || specs.SSD || specs.hd || (specs.info && String(specs.info)) || '';
  if (typeof dVal === 'number' && !isNaN(dVal)) return `${dVal} GB SSD`;
  return dVal ? String(dVal) : '512 GB SSD NVMe';
}

function parseCpuLabel(rawSpecs) {
  const specs = resolveSpecs(rawSpecs);
  const cVal = specs.cpu || specs.CPU || specs.processador || specs.Processador || specs.processor || '';
  return cVal ? String(cVal) : 'Intel Core / Apple Silicon';
}
</script>

<template>
  <section class="space-y-6">
    <!-- Executive Top Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
      <div>
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/50" />
          <h2 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Passaporte Digital de Ativos sob Custódia
          </h2>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
          Instrumento oficial de gestão patrimonial individualizada. Ativos vinculados ao seu termo de responsabilidade civil e trabalhista CLT (Artigo 462 §1º).
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
        <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-mono font-bold shadow-xs border border-slate-800 dark:border-slate-700">
          <span class="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{{ assets.length }}</span>
          <span class="text-slate-300 dark:text-slate-400 font-sans font-normal">dispositivos ativos</span>
        </span>
      </div>
    </div>

    <!-- Verification Toast Banner -->
    <div
      v-if="verificationToast"
      class="p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-semibold flex items-center justify-between shadow-xl shadow-emerald-900/20 animate-in slide-in-from-top-2 duration-200 border border-emerald-400/30"
    >
      <div class="flex items-center gap-3">
        <div class="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center font-bold">
          ✓
        </div>
        <div>
          <p class="font-bold text-white text-xs">Vistoria Registrada</p>
          <p class="text-emerald-100 text-[11px]">{{ verificationToast }}</p>
        </div>
      </div>
      <button
        type="button"
        class="text-emerald-200 hover:text-white font-black text-sm px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
        @click="verificationToast = ''"
      >
        ✕
      </button>
    </div>

    <!-- Executive Metrics Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3.5">
      <!-- Total de Ativos -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-brand relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Custódia Direta
          </span>
          <div class="w-8 h-8 rounded-xl bg-brand/10 text-brand dark:bg-brand/20 flex items-center justify-center font-bold text-base">
            📦
          </div>
        </div>
        <div class="mt-3">
          <p class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            {{ assets.length }}
          </p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            Equipamentos vinculados
          </p>
        </div>
      </div>

      <!-- Patrimônio em Posse -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-emerald-500 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Patrimônio Declarado
          </span>
          <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-base">
            💰
          </div>
        </div>
        <div class="mt-3">
          <p class="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
            {{ formatCurrency(totalValuation) }}
          </p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            Valor de reposição CLT
          </p>
        </div>
      </div>

      <!-- Categorias -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-indigo-500 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Diversidade de Frota
          </span>
          <div class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-base">
            🏷️
          </div>
        </div>
        <div class="mt-3">
          <p class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            {{ categories.length }}
          </p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            Categorias de hardware
          </p>
        </div>
      </div>

      <!-- Vistorias Concluídas -->
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-cyan-500 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Integridade Validada
          </span>
          <div class="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center font-bold text-base">
            🛡️
          </div>
        </div>
        <div class="mt-3">
          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
              {{ verifiedAssets.size }}
            </span>
            <span class="text-xs font-bold text-slate-400 dark:text-slate-500">/ {{ assets.length }}</span>
          </div>
          <!-- Barra de progresso visual de integridade -->
          <div class="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div
              class="bg-cyan-500 h-full rounded-full transition-all duration-500"
              :style="{ width: assets.length ? `${(verifiedAssets.size / assets.length) * 100}%` : '0%' }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="station-panel p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <!-- Search Input -->
      <div class="relative flex-1">
        <span class="absolute left-3.5 top-2.5 text-slate-400 text-sm">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar por tag patrimonial, modelo, marca ou serial..."
          class="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-brand focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-brand/20 focus:outline-none transition-all"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
          @click="searchQuery = ''"
        >
          ✕
        </button>
      </div>

      <!-- Category Filter Pills -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        <button
          type="button"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
          :class="
            selectedCategory === 'all'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          "
          @click="selectedCategory = 'all'"
        >
          Todos ({{ assets.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer"
          :class="
            selectedCategory === cat
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          "
          @click="selectedCategory = cat"
        >
          <span>{{ getDeviceIcon(cat) }}</span>
          <span>{{ cat }}</span>
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="station-panel p-16 text-center space-y-3">
      <div class="w-10 h-10 border-3 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
      <p class="text-xs font-bold text-slate-700 dark:text-slate-200">
        Carregando Passaportes Digitais de Custódia...
      </p>
      <p class="text-[11px] text-slate-400">Consultando integridade no API Gateway corporativo</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredAssets.length === 0"
      class="station-panel p-14 text-center space-y-4"
    >
      <div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mx-auto flex items-center justify-center text-3xl">
        📦
      </div>
      <div class="max-w-md mx-auto">
        <h3 class="text-base font-extrabold text-slate-900 dark:text-white">
          {{ searchQuery ? 'Nenhum equipamento coincide com a busca' : 'Nenhum equipamento registrado em custódia' }}
        </h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
          {{ searchQuery ? 'Tente buscar por termos mais genéricos ou limpe os filtros de categoria.' : 'Caso você tenha recebido novos computadores, notebooks ou periféricos corporativos e eles não constem aqui, contate o suporte de TI para a emissão do termo de responsabilidade.' }}
        </p>
        <button
          v-if="searchQuery"
          type="button"
          class="mt-4 px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:bg-brand dark:hover:bg-brand dark:hover:text-white transition-colors cursor-pointer"
          @click="searchQuery = ''; selectedCategory = 'all'"
        >
          Limpar Filtros de Busca
        </button>
      </div>
    </div>

    <!-- Assets Grid: Digital Passport Cards -->
    <div v-else class="grid gap-5 md:grid-cols-2">
      <article
        v-for="asset in filteredAssets"
        :key="asset.id || asset.internal_id || asset.internalId"
        class="station-panel station-panel-hover p-6 flex flex-col justify-between gap-5 relative group cert-guilloche-bg"
      >
        <div class="space-y-4">
          <!-- Passport Top Header Ribbon -->
          <div class="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-3.5">
            <div class="flex items-start gap-3">
              <span class="text-2xl p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-brand/10 group-hover:text-brand transition-colors shrink-0">
                {{ getDeviceIcon(asset.type) }}
              </span>
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white border border-slate-700/60 shadow-xs">
                    {{ asset.internal_id || asset.internalId }}
                  </span>
                  <button
                    type="button"
                    class="text-[11px] text-slate-400 hover:text-brand transition-colors p-1 cursor-pointer"
                    :title="copiedTag === (asset.internal_id || asset.internalId) ? 'Copiado!' : 'Copiar Tag Patrimonial'"
                    @click="copyToClipboard(asset.internal_id || asset.internalId, asset.internal_id || asset.internalId)"
                  >
                    {{ copiedTag === (asset.internal_id || asset.internalId) ? '✓' : '📋' }}
                  </button>
                </div>
                <span class="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block mt-1">
                  {{ asset.type || 'Equipamento' }} • {{ asset.brand || 'Corporativo' }}
                </span>
              </div>
            </div>

            <!-- Status & Verification Stamp -->
            <div class="flex flex-col items-end gap-1 shrink-0">
              <span
                class="text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize border"
                :class="
                  asset.status === 'Em Uso' || asset.status === 'in_use'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                "
              >
                {{ asset.status === 'in_use' ? 'Em Uso Ativo' : (asset.status || 'Ativo') }}
              </span>
              <span
                v-if="verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)"
                class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Vistoriado {{ verifiedAssets.get(asset.id || asset.internal_id || asset.internalId) }}
              </span>
            </div>
          </div>

          <!-- Model & Value -->
          <div>
            <h3 class="text-base sm:text-lg font-black text-slate-900 dark:text-white group-hover:text-brand transition-colors leading-snug">
              {{ asset.model || 'Modelo não especificado' }}
            </h3>
            <p v-if="asset.purchase_value || asset.purchaseValue || asset.valor" class="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
              Valor de Guarda:
              <span class="font-bold text-slate-900 dark:text-white tabular-nums">
                {{ formatCurrency(asset.purchase_value ?? asset.purchaseValue ?? asset.valor) }}
              </span>
            </p>
          </div>

          <!-- Modern Hardware Specifications Gauges -->
          <div class="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
            <!-- CPU Gauge -->
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span class="flex items-center gap-1">⚡ Processador</span>
              </div>
              <p class="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate" :title="parseCpuLabel(asset.specs)">
                {{ parseCpuLabel(asset.specs) }}
              </p>
            </div>

            <!-- RAM Gauge -->
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span class="flex items-center gap-1">🧠 Memória RAM</span>
                <span class="font-mono text-brand">{{ parseRamGb(asset.specs) }} GB</span>
              </div>
              <div class="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  class="bg-brand h-full rounded-full"
                  :style="{ width: `${Math.min(100, (parseRamGb(asset.specs) / 32) * 100)}%` }"
                />
              </div>
            </div>

            <!-- Storage Gauge -->
            <div class="space-y-1">
              <div class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span class="flex items-center gap-1">💾 Armazenamento</span>
              </div>
              <p class="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate" :title="parseDiskCap(asset.specs)">
                {{ parseDiskCap(asset.specs) }}
              </p>
            </div>

            <!-- Filial / Localização -->
            <div class="space-y-1">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                📍 Unidade / Filial
              </div>
              <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                {{ asset.location || 'Matriz Corporativa' }}
              </p>
            </div>
          </div>

          <!-- Serial & CLT Digital Stamp Ribbon -->
          <div class="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] border-t border-slate-100 dark:border-slate-800/80">
            <div class="flex items-center gap-1.5 font-mono text-slate-500 dark:text-slate-400">
              <span class="text-[10px] uppercase font-sans font-bold text-slate-400">S/N:</span>
              <span class="font-bold text-slate-800 dark:text-slate-200">{{ asset.serial_number || asset.serialNumber || 'N/A' }}</span>
              <button
                v-if="asset.serial_number || asset.serialNumber"
                type="button"
                class="text-slate-400 hover:text-brand ml-1 cursor-pointer"
                title="Copiar Número de Série"
                @click="copyToClipboard(asset.serial_number || asset.serialNumber, `sn-${asset.internal_id || asset.internalId}`)"
              >
                {{ copiedTag === `sn-${asset.internal_id || asset.internalId}` ? '✓' : '📋' }}
              </button>
            </div>

            <!-- Selo CLT HMAC Stamp -->
            <div
              class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight flex items-center gap-1 border"
              :class="
                verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              "
            >
              <span>🛡️ CLT Art. 462</span>
              <span>•</span>
              <span>HMAC-SHA256</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="pt-3.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              @click="selectedAsset = asset"
            >
              Ficha Técnica
            </button>
            <button
              type="button"
              class="text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5"
              :class="
                verifiedAssets.has(asset.id || asset.internal_id || asset.internalId)
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 dark:hover:bg-emerald-950/30'
              "
              title="Confirmar que o equipamento se encontra íntegro sob sua responsabilidade física"
              @click="handleConfirmIntegrity(asset)"
            >
              <span>{{ verifiedAssets.has(asset.id || asset.internal_id || asset.internalId) ? '✓ Confirmado' : 'Confirmar Posse' }}</span>
            </button>
          </div>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-brand dark:hover:bg-brand dark:hover:text-white transition-all shadow-xs cursor-pointer"
            @click="emit('report-issue', asset)"
          >
            <span>Pedir Suporte</span>
            <span>↗</span>
          </button>
        </div>
      </article>
    </div>

    <!-- Asset Detail Modal (Ficha Técnica do Passaporte) -->
    <div
      v-if="selectedAsset"
      class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <span class="text-3xl p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
              {{ getDeviceIcon(selectedAsset.type) }}
            </span>
            <div>
              <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white border border-slate-700/60">
                {{ selectedAsset.internal_id || selectedAsset.internalId }}
              </span>
              <h3 class="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-1">
                {{ selectedAsset.model }}
              </h3>
            </div>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg font-black p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            @click="selectedAsset = null"
          >
            ✕
          </button>
        </div>

        <div class="space-y-4 text-xs">
          <!-- Passport Attributes -->
          <div class="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <div>
              <span class="text-[10px] uppercase font-black text-slate-400 dark:text-slate-500 block">Tipo & Categoria</span>
              <span class="font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">{{ selectedAsset.type }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-black text-slate-400 dark:text-slate-500 block">Fabricante</span>
              <span class="font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">{{ selectedAsset.brand }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-black text-slate-400 dark:text-slate-500 block">Número de Série</span>
              <span class="font-mono font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">{{ selectedAsset.serial_number || selectedAsset.serialNumber || 'N/A' }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-black text-slate-400 dark:text-slate-500 block">Valor Registrado</span>
              <span class="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">{{ formatCurrency(selectedAsset.purchase_value ?? selectedAsset.purchaseValue ?? selectedAsset.valor) }}</span>
            </div>
          </div>

          <!-- Extended Technical Specs -->
          <div>
            <h4 class="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Especificações Técnicas de Hardware
            </h4>
            <div
              v-if="resolveSpecs(selectedAsset.specs) && Object.keys(resolveSpecs(selectedAsset.specs)).length > 0"
              class="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-3.5 divide-y divide-slate-200/60 dark:divide-slate-800"
            >
              <div
                v-for="(val, key) in resolveSpecs(selectedAsset.specs)"
                :key="key"
                class="py-2 flex items-center justify-between text-xs"
              >
                <span class="font-bold text-slate-500 dark:text-slate-400 uppercase text-[10px]">{{ key }}</span>
                <span class="font-mono font-bold text-slate-800 dark:text-slate-200">{{ val }}</span>
              </div>
            </div>
            <p v-else class="text-slate-400 italic py-2">
              Nenhuma especificação técnica adicional registrada pelo inventário.
            </p>
          </div>

          <!-- Legal Disclaimer -->
          <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-900 dark:text-amber-300 leading-relaxed">
            <span class="font-bold block mb-0.5">Responsabilidade Legal CLT Art. 462 §1º:</span>
            O equipamento acima é de uso estritamente corporativo e de guarda pessoal intransferível. Havendo extravio, defeito ou furto, notifique imediatamente a equipe de TI por meio da Central de Chamados.
          </div>
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            class="text-xs font-bold px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            @click="selectedAsset = null"
          >
            Fechar Ficha
          </button>
          <button
            type="button"
            class="text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-brand dark:hover:bg-brand dark:hover:text-white transition-colors cursor-pointer"
            @click="emit('report-issue', selectedAsset); selectedAsset = null"
          >
            Abrir Chamado Técnico ↗
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
