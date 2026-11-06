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
const verifiedAssets = ref(new Set());
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
  return (props.assets || []).reduce((acc, a) => acc + parseAssetValue(a.purchase_value ?? a.valor ?? a.purchaseValue ?? 0), 0);
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
  verifiedAssets.value.add(asset.id || asset.internal_id);
  verificationToast.value = `Posse e integridade de ${asset.internal_id} confirmadas com sucesso!`;
  setTimeout(() => {
    verificationToast.value = '';
  }, 4000);
}
</script>

<template>
  <section class="space-y-6">
    <!-- Executive Top Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/90 pb-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h2 class="text-xl font-black tracking-tight text-slate-900">
            Equipamentos sob Minha Custódia
          </h2>
        </div>
        <p class="text-xs text-slate-500 mt-0.5">
          Painel oficial de ativos de TI corporativos vinculados ao seu termo de responsabilidade CLT (Art. 462 §1º).
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto">
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-mono font-bold shadow-xs">
          <span>{{ assets.length }}</span>
          <span class="text-slate-300 font-sans font-normal">dispositivos</span>
        </span>
      </div>
    </div>

    <!-- Verification Toast Banner -->
    <div
      v-if="verificationToast"
      class="p-3.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center justify-between shadow-lg animate-in slide-in-from-top-2 duration-200"
    >
      <div class="flex items-center gap-2">
        <span>✓</span>
        <span>{{ verificationToast }}</span>
      </div>
      <button type="button" class="text-emerald-200 hover:text-white font-bold" @click="verificationToast = ''">
        ✕
      </button>
    </div>

    <!-- Executive Metrics Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-brand bg-gradient-to-br from-white to-slate-50/70">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total de Ativos</span>
          <span class="text-lg">📦</span>
        </div>
        <div class="mt-2">
          <p class="text-2xl font-black text-slate-900">{{ assets.length }}</p>
          <p class="text-[11px] text-slate-500 font-medium">Equipamentos ativos</p>
        </div>
      </div>

      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-emerald-500 bg-gradient-to-br from-white to-slate-50/70">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Patrimônio em Posse</span>
          <span class="text-lg">💰</span>
        </div>
        <div class="mt-2">
          <p class="text-2xl font-black text-slate-900 tabular-nums">
            {{ formatCurrency(totalValuation) }}
          </p>
          <p class="text-[11px] text-slate-500 font-medium">Valor total inventariado</p>
        </div>
      </div>

      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-indigo-500 bg-gradient-to-br from-white to-slate-50/70">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Categorias</span>
          <span class="text-lg">🏷️</span>
        </div>
        <div class="mt-2">
          <p class="text-2xl font-black text-slate-900">{{ categories.length }}</p>
          <p class="text-[11px] text-slate-500 font-medium">Tipos de hardware</p>
        </div>
      </div>

      <div class="station-panel p-4 flex flex-col justify-between border-l-4 border-l-cyan-500 bg-gradient-to-br from-white to-slate-50/70">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vistorias Concluídas</span>
          <span class="text-lg">🛡️</span>
        </div>
        <div class="mt-2">
          <p class="text-2xl font-black text-slate-900">
            {{ verifiedAssets.size }} / {{ assets.length }}
          </p>
          <p class="text-[11px] text-slate-500 font-medium">Integridade validada</p>
        </div>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs">
      <!-- Search Input -->
      <div class="relative flex-1">
        <span class="absolute left-3.5 top-2.5 text-slate-400 text-sm">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar por tag (ex: SHL-BEL-NTB-001), modelo, marca ou serial..."
          class="w-full pl-9 pr-3.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50/50 text-xs text-slate-800 placeholder-slate-400 focus:border-brand focus:bg-white focus:outline-none transition-all"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
          @click="searchQuery = ''"
        >
          ✕
        </button>
      </div>

      <!-- Category Filter Pills -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
        <button
          type="button"
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0"
          :class="selectedCategory === 'all' ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="selectedCategory = 'all'"
        >
          Todos ({{ assets.length }})
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1"
          :class="selectedCategory === cat ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="selectedCategory = cat"
        >
          <span>{{ getDeviceIcon(cat) }}</span>
          <span>{{ cat }}</span>
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="station-panel p-12 text-center space-y-3">
      <div class="w-9 h-9 border-3 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
      <p class="text-xs font-bold text-slate-600">Carregando inventário de equipamentos sob custódia...</p>
      <p class="text-[11px] text-slate-400">Consultando base de ativos e termos vigentes</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="filteredAssets.length === 0"
      class="station-panel p-12 text-center space-y-4"
    >
      <div class="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-3xl">
        📦
      </div>
      <div class="max-w-md mx-auto">
        <h3 class="text-base font-extrabold text-slate-900">
          {{ searchQuery ? 'Nenhum equipamento coincide com a busca' : 'Nenhum equipamento registrado em custódia' }}
        </h3>
        <p class="text-xs text-slate-500 mt-1.5 leading-relaxed">
          {{ searchQuery ? 'Tente buscar por termos mais genéricos ou limpe os filtros de categoria.' : 'Caso você tenha recebido novos computadores, notebooks ou periféricos corporativos e eles não constem aqui, contate imediatamente o suporte de TI para a emissão do termo de responsabilidade.' }}
        </p>
        <button
          v-if="searchQuery"
          type="button"
          class="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-brand transition-colors"
          @click="searchQuery = ''; selectedCategory = 'all'"
        >
          Limpar Filtros de Busca
        </button>
      </div>
    </div>

    <!-- Assets Grid -->
    <div v-else class="grid gap-4 md:grid-cols-2">
      <article
        v-for="asset in filteredAssets"
        :key="asset.id || asset.internal_id"
        class="station-panel p-5 flex flex-col justify-between gap-4 hover:border-brand/40 hover:shadow-lg transition-all group relative bg-white"
      >
        <div class="space-y-3.5">
          <!-- Card Top Bar -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl p-2 rounded-xl bg-slate-100 group-hover:bg-brand/10 transition-colors shadow-2xs">
                {{ getDeviceIcon(asset.type) }}
              </span>
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded-lg bg-slate-900 text-white shadow-2xs">
                    {{ asset.internal_id }}
                  </span>
                  <button
                    type="button"
                    class="text-[10px] text-slate-400 hover:text-brand transition-colors p-1"
                    :title="copiedTag === asset.internal_id ? 'Copiado!' : 'Copiar Tag Patrimonial'"
                    @click="copyToClipboard(asset.internal_id, asset.internal_id)"
                  >
                    {{ copiedTag === asset.internal_id ? '✓' : '📋' }}
                  </button>
                </div>
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-0.5">
                  {{ asset.type || 'Equipamento' }} • {{ asset.brand || 'Marca Corporativa' }}
                </span>
              </div>
            </div>

            <!-- Status Pill -->
            <div class="flex flex-col items-end gap-1">
              <span
                class="text-[11px] font-bold px-2.5 py-0.5 rounded-full capitalize"
                :class="
                  asset.status === 'Em Uso' || asset.status === 'in_use'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                "
              >
                {{ asset.status === 'in_use' ? 'Em Uso Ativo' : (asset.status || 'Ativo') }}
              </span>
              <span
                v-if="verifiedAssets.has(asset.id || asset.internal_id)"
                class="text-[10px] font-semibold text-emerald-600 flex items-center gap-0.5"
              >
                ✓ Vistoriado hoje
              </span>
            </div>
          </div>

          <!-- Model & Brand -->
          <div>
            <h3 class="text-base font-extrabold text-slate-900 group-hover:text-brand transition-colors leading-snug">
              {{ asset.model || 'Modelo não especificado' }}
            </h3>
            <p v-if="asset.purchase_value" class="text-xs font-semibold text-slate-600 mt-0.5">
              Valor Declarado: <span class="font-bold text-slate-900 tabular-nums">{{ formatCurrency(asset.purchase_value) }}</span>
            </p>
          </div>

          <!-- Meta Information Grid -->
          <dl class="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-slate-100 text-xs">
            <div class="bg-slate-50/80 p-2 rounded-lg">
              <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nº de Série (S/N)</dt>
              <dd class="font-mono font-bold text-slate-800 truncate mt-0.5 flex items-center justify-between">
                <span>{{ asset.serial_number || 'N/A' }}</span>
                <button
                  v-if="asset.serial_number"
                  type="button"
                  class="text-[10px] text-slate-400 hover:text-brand ml-1"
                  title="Copiar S/N"
                  @click="copyToClipboard(asset.serial_number, `sn-${asset.internal_id}`)"
                >
                  {{ copiedTag === `sn-${asset.internal_id}` ? '✓' : '📋' }}
                </button>
              </dd>
            </div>
            <div class="bg-slate-50/80 p-2 rounded-lg">
              <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Alocação / Filial</dt>
              <dd class="font-semibold text-slate-700 truncate mt-0.5">
                {{ asset.location || 'Matriz Corporativa' }}
              </dd>
            </div>
          </dl>

          <!-- Technical Specs Badges -->
          <div
            v-if="asset.specs && Object.keys(asset.specs).length > 0"
            class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs text-slate-700 grid grid-cols-2 gap-2"
          >
            <div v-for="(val, key) in asset.specs" :key="key" class="truncate">
              <span class="text-[9px] uppercase font-bold text-slate-400 block">{{ key }}</span>
              <span class="font-mono font-semibold text-[11px] text-slate-800 truncate block">{{ val }}</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              @click="selectedAsset = asset"
            >
              Ficha Técnica
            </button>
            <button
              type="button"
              class="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 transition-colors"
              title="Confirmar que o equipamento está em bom estado e em suas mãos"
              @click="handleConfirmIntegrity(asset)"
            >
              {{ verifiedAssets.has(asset.id || asset.internal_id) ? '✓ Confirmado' : 'Confirmar Posse' }}
            </button>
          </div>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-brand transition-colors shadow-2xs"
            @click="emit('report-issue', asset)"
          >
            <span>Solicitar Suporte</span>
            <span>↗</span>
          </button>
        </div>
      </article>
    </div>

    <!-- Asset Detail Modal -->
    <div
      v-if="selectedAsset"
      class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4"
    >
      <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5 border border-slate-200 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center gap-3">
            <span class="text-3xl p-2.5 rounded-xl bg-slate-100">
              {{ getDeviceIcon(selectedAsset.type) }}
            </span>
            <div>
              <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded bg-slate-900 text-white">
                {{ selectedAsset.internal_id }}
              </span>
              <h3 class="text-base font-extrabold text-slate-900 mt-1">
                {{ selectedAsset.model }}
              </h3>
            </div>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-slate-700 text-lg font-bold p-1"
            @click="selectedAsset = null"
          >
            ✕
          </button>
        </div>

        <div class="space-y-4 text-xs">
          <div class="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Tipo & Categoria</span>
              <span class="font-bold text-slate-800">{{ selectedAsset.type }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Fabricante</span>
              <span class="font-bold text-slate-800">{{ selectedAsset.brand }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Nº de Série</span>
              <span class="font-mono font-bold text-slate-800">{{ selectedAsset.serial_number || 'N/A' }}</span>
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Valor Patrimonial</span>
              <span class="font-bold text-emerald-700">{{ formatCurrency(selectedAsset.purchase_value) }}</span>
            </div>
          </div>

          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Especificações de Hardware & Sistema
            </h4>
            <div
              v-if="selectedAsset.specs && Object.keys(selectedAsset.specs).length > 0"
              class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 divide-y divide-slate-100"
            >
              <div
                v-for="(val, key) in selectedAsset.specs"
                :key="key"
                class="py-1.5 flex items-center justify-between text-xs"
              >
                <span class="font-semibold text-slate-500 uppercase text-[10px]">{{ key }}</span>
                <span class="font-mono font-bold text-slate-800">{{ val }}</span>
              </div>
            </div>
            <p v-else class="text-slate-400 italic">
              Nenhuma especificação técnica detalhada disponível no momento.
            </p>
          </div>

          <div class="p-3 rounded-xl bg-slate-100 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
            <span class="font-bold text-slate-900 block mb-0.5">Responsabilidade Legal CLT Art. 462:</span>
            Este equipamento é intransferível e de uso estritamente corporativo. Em caso de furto, perda, quebra ou necessidade de reparo, comunique imediatamente a TI corporativa através da central de chamados.
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-slate-100">
          <button
            type="button"
            class="text-xs font-semibold px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100"
            @click="selectedAsset = null"
          >
            Fechar
          </button>
          <button
            type="button"
            class="text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-brand transition-colors"
            @click="emit('report-issue', selectedAsset); selectedAsset = null"
          >
            Abrir Chamado Técnico para este Ativo ↗
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
