<script setup>
defineProps({
  assets: { type: Array, required: true },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['report-issue']);
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="font-mono text-[11px] uppercase tracking-widest text-indigo-600 font-semibold">
          API 1 (REST) • /api/v1/assets
        </p>
        <h2 class="text-lg font-bold tracking-tight text-slate-900">
          Equipamentos sob Minha Custódia
        </h2>
      </div>
      <span class="mono-tag">{{ assets.length }} itens vinculados</span>
    </div>

    <div v-if="loading" class="station-panel p-8 text-center text-sm text-slate-500">
      Carregando inventário vinculado...
    </div>

    <div
      v-else-if="assets.length === 0"
      class="station-panel p-8 text-center text-sm text-slate-500"
    >
      Nenhum equipamento registrado sob sua responsabilidade no momento.
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <article
        v-for="asset in assets"
        :key="asset.id"
        class="station-panel p-5 flex flex-col justify-between gap-4 hover:border-indigo-300 transition-colors"
      >
        <div class="space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs font-bold px-2.5 py-1 rounded bg-slate-900 text-white">
              {{ asset.internal_id }}
            </span>
            <span
              class="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
            >
              {{ asset.status }}
            </span>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {{ asset.type }} • {{ asset.brand }}
            </p>
            <h3 class="text-base font-bold text-slate-900">{{ asset.model }}</h3>
          </div>

          <dl class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
            <div>
              <dt class="text-slate-400">Nº de Série</dt>
              <dd class="font-mono font-semibold text-slate-700">
                {{ asset.serial_number || 'N/A' }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-400">Localização</dt>
              <dd class="font-medium text-slate-700">{{ asset.location || 'Matriz' }}</dd>
            </div>
          </dl>

          <div
            v-if="asset.specs && Object.keys(asset.specs).length > 0"
            class="bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 text-[11px] font-mono text-slate-600 space-y-0.5"
          >
            <div v-for="(val, key) in asset.specs" :key="key">
              <span class="uppercase text-slate-400">{{ key }}:</span> {{ val }}
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            class="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors"
            @click="emit('report-issue', asset)"
          >
            Solicitar suporte para {{ asset.internal_id }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
