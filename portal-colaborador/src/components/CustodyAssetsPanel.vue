<script setup>
defineProps({
  assets: { type: Array, required: true },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['report-issue']);

function getDeviceIcon(type = '') {
  const t = type.toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return '💻';
  if (t.includes('monit')) return '🖥️';
  if (t.includes('phone') || t.includes('celular')) return '📱';
  if (t.includes('desk') || t.includes('serv')) return '🗄️';
  return '📦';
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
      <div>
        <h2 class="text-lg font-extrabold tracking-tight text-slate-900">
          Equipamentos sob Minha Custódia
        </h2>
        <p class="text-xs text-slate-500">
          Inventário de computadores, monitores e dispositivos vinculados ao seu termo de responsabilidade.
        </p>
      </div>
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-mono font-bold self-start sm:self-auto shadow-xs">
        <span>{{ assets.length }}</span>
        <span class="text-slate-300 font-sans font-normal">dispositivos</span>
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="station-panel p-10 text-center space-y-2">
      <div class="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
      <p class="text-xs font-medium text-slate-500">Carregando inventário de equipamentos vinculados...</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="assets.length === 0"
      class="station-panel p-10 text-center space-y-3"
    >
      <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center text-xl">
        📦
      </div>
      <div>
        <h3 class="text-sm font-bold text-slate-800">Nenhum equipamento em custódia</h3>
        <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">
          Não constam dispositivos registrados sob sua responsabilidade no momento. Caso tenha recebido um equipamento, contate o departamento de TI.
        </p>
      </div>
    </div>

    <!-- Assets Grid -->
    <div v-else class="grid gap-4 md:grid-cols-2">
      <article
        v-for="asset in assets"
        :key="asset.id"
        class="station-panel p-5 flex flex-col justify-between gap-4 hover:border-brand/40 hover:shadow-md transition-all group"
      >
        <div class="space-y-3">
          <!-- Card Header -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xl p-1.5 rounded-lg bg-slate-100 group-hover:bg-brand/10 transition-colors">
                {{ getDeviceIcon(asset.type) }}
              </span>
              <div>
                <span class="font-mono text-xs font-black px-2.5 py-0.5 rounded bg-slate-900 text-white shadow-2xs">
                  {{ asset.internal_id }}
                </span>
              </div>
            </div>
            <span
              class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 capitalize"
            >
              {{ asset.status === 'in_use' ? 'Em Uso Ativo' : (asset.status || 'Ativo') }}
            </span>
          </div>

          <!-- Model & Brand -->
          <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {{ asset.type }} • {{ asset.brand }}
            </p>
            <h3 class="text-base font-extrabold text-slate-900 group-hover:text-brand transition-colors">
              {{ asset.model }}
            </h3>
          </div>

          <!-- Meta Information Grid -->
          <dl class="grid grid-cols-2 gap-2 pt-2.5 border-t border-slate-100 text-xs">
            <div>
              <dt class="text-[11px] text-slate-400">Nº de Série (S/N)</dt>
              <dd class="font-mono font-bold text-slate-800 truncate">
                {{ asset.serial_number || 'N/A' }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-slate-400">Localização</dt>
              <dd class="font-medium text-slate-700 truncate">
                {{ asset.location || 'Matriz Corporativa' }}
              </dd>
            </div>
          </dl>

          <!-- Technical Specs Badges -->
          <div
            v-if="asset.specs && Object.keys(asset.specs).length > 0"
            class="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-xs text-slate-700 grid grid-cols-2 gap-2"
          >
            <div v-for="(val, key) in asset.specs" :key="key" class="truncate">
              <span class="text-[10px] uppercase font-bold text-slate-400 block">{{ key }}</span>
              <span class="font-mono font-semibold text-[11px] text-slate-800">{{ val }}</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-400">Suporte 24/7 disponível</span>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-brand transition-colors shadow-2xs"
            @click="emit('report-issue', asset)"
          >
            <span>Solicitar Suporte</span>
            <span>↗</span>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
