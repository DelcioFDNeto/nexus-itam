<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import PortalIcon from './PortalIcon.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  userName: { type: String, default: '' },
  companyName: { type: String, default: 'Nexus ITAM' },
  department: { type: String, default: '' },
  assetsCount: { type: Number, default: 0 },
  pendingTermsCount: { type: Number, default: 0 },
  openTicketsCount: { type: Number, default: 0 },
  isReplay: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'complete', 'select-tab']);

const currentStepIndex = ref(0);
const spotlightRect = ref(null);
const cardEl = ref(null);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 800);

const firstName = computed(() => {
  const clean = String(props.userName || '').trim();
  if (!clean) return 'Colaborador(a)';
  return clean.split(/\s+/)[0];
});

const steps = computed(() => {
  const pendingCount = Number(props.pendingTermsCount || 0);
  const assetsQty = Number(props.assetsCount || 0);
  const dept = String(props.department || '').trim();

  return [
    {
      id: 'welcome',
      badge: props.isReplay ? 'Tour Guiado do Portal' : 'Primeiro Acesso • Tour Rápido (1 min)',
      icon: 'compass',
      placement: 'center',
      title: `Bem-vindo(a), ${firstName.value}!`,
      description: `Este é o Portal do Colaborador da ${props.companyName}. Em menos de 1 minuto vamos mostrar onde consultar seus equipamentos, assinar termos CLT, falar com a TI e acessar arquivos na nuvem.`,
      highlights: [
        { icon: 'laptop', label: 'Meus Equipamentos', text: 'Ativos sob sua guarda' },
        { icon: 'clipboard-check', label: 'Termos CLT', text: 'Assinatura digital e PDF' },
        { icon: 'headphones', label: 'Suporte de TI', text: 'Chamados e chat ao vivo' },
        { icon: 'cloud', label: 'Arquivos & Nuvem', text: 'Pastas, ZIP e Auto-Sync' },
      ],
      callout:
        pendingCount > 0
          ? {
              tone: 'amber',
              text: `Você tem ${pendingCount} ${pendingCount === 1 ? 'termo CLT aguardando' : 'termos CLT aguardando'} sua assinatura digital.`,
            }
          : assetsQty > 0
            ? {
                tone: 'emerald',
                text: `${assetsQty} ${assetsQty === 1 ? 'equipamento já está vinculado' : 'equipamentos já estão vinculados'} ao seu cadastro.`,
              }
            : null,
    },
    {
      id: 'summary',
      badge: 'Visão Geral',
      icon: 'sparkles',
      tab: 'custody',
      targetSelector: '[data-tour="summary-cards"]',
      placement: 'bottom',
      title: 'Resumo rápido em tempo real',
      description:
        'Estes 3 cartões mostram de imediato quantos equipamentos estão com você, sua situação nos termos de responsabilidade CLT e quantos chamados de TI estão em andamento.',
      tip: 'Sempre que o indicador "Tempo real ativo" no topo estiver verde, respostas da TI e novos termos aparecem automaticamente sem precisar atualizar a página.',
    },
    {
      id: 'custody',
      badge: 'Aba 1 • Patrimônio',
      icon: 'laptop',
      tab: 'custody',
      targetSelector: '#tab-custody',
      placement: 'bottom',
      title: 'Meus equipamentos (Passaporte Patrimonial)',
      description:
        'Consulte todos os notebooks, celulares, monitores e acessórios vinculados à sua matrícula, com etiqueta patrimonial, número de série e histórico de custódia.',
      tip: 'Se algum equipamento apresentar defeito, clique em "Reportar problema" direto no cartão do item — o chamado de suporte já abre vinculado à etiqueta correta.',
    },
    {
      id: 'terms',
      badge: 'Aba 2 • Conformidade CLT',
      icon: 'clipboard-check',
      tab: 'terms',
      targetSelector: '#tab-terms',
      placement: 'bottom',
      title: 'Termos de responsabilidade digital',
      description:
        'Sempre que você receber um novo equipamento ou houver atualização de custódia, o Termo (Art. 462 §1º CLT) aparece aqui para revisão e assinatura na própria tela.',
      tip:
        pendingCount > 0
          ? `Você tem ${pendingCount} ${pendingCount === 1 ? 'termo pendente' : 'termos pendentes'} agora. Ao finalizar este tour, você pode ir direto assiná-lo.`
          : 'Após assinar com o mouse ou dedo, você pode baixar a qualquer momento sua cópia em PDF com selo criptográfico de autenticidade.',
      callout:
        pendingCount > 0
          ? {
              tone: 'amber',
              text: `${pendingCount} ${pendingCount === 1 ? 'termo pendente' : 'termos pendentes'} nesta aba.`,
            }
          : null,
    },
    {
      id: 'tickets',
      badge: 'Aba 3 • Autoatendimento',
      icon: 'headphones',
      tab: 'tickets',
      targetSelector: '#tab-tickets',
      placement: 'bottom',
      title: 'Central de chamados e chat com a TI',
      description:
        'Precisa de ajuda técnica, acesso a sistemas, instalação de programas ou manutenção? Abra um chamado aqui, anexe fotos ou prints e acompanhe o atendimento passo a passo.',
      tip: 'Converse em tempo real com o técnico pelo chat integrado do chamado. Quando chegar uma nova resposta, um aviso aparece automaticamente.',
    },
    {
      id: 'cloud',
      badge: 'Aba 4 • Nuvem Corporativa',
      icon: 'cloud',
      tab: 'cloud',
      targetSelector: '#tab-cloud',
      placement: 'bottom',
      title: dept ? `Arquivos & Nuvem do setor ${dept}` : 'Arquivos & Nuvem da Empresa',
      description:
        'Um explorador de arquivos igual ao do Windows com as pastas liberadas para a sua equipe — com organização segura e acesso rápido pelo navegador.',
      features: [
        {
          icon: 'folder-up',
          title: 'Subir pastas inteiras',
          text: 'Arraste pastas do PC ou clique em "Enviar Pasta" sem precisar compactar em ZIP/RAR.',
        },
        {
          icon: 'package-open',
          title: 'Descompactar direto na nuvem',
          text: 'Extraia arquivos .ZIP, .RAR e .TAR sem baixar nada para o computador.',
        },
        {
          icon: 'monitor',
          title: 'Editar planilhas no Excel real (Auto-Sync)',
          text: 'Clique em "Editar no PC" para abrir no Excel e salvar na VPS a cada Ctrl+S.',
        },
      ],
    },
    {
      id: 'done',
      badge: 'Tour Concluído',
      icon: 'check-circle',
      placement: 'center',
      title: `Tudo pronto, ${firstName.value}!`,
      description:
        'Agora você já conhece todas as áreas do seu Portal. Sempre que quiser rever este passo a passo, clique no botão "Tour Guiado" na barra superior.',
      checklist: [
        'Consultar equipamentos e reportar problemas direto do item',
        'Revisar, assinar digitalmente e baixar Termos CLT em PDF',
        'Abrir chamados com anexos e conversar ao vivo com a TI',
        'Usar pastas na nuvem, descompactar arquivos e editar no Excel com Auto-Sync',
      ],
    },
  ];
});

const currentStep = computed(() => steps.value[currentStepIndex.value] || steps.value[0]);
const totalSteps = computed(() => steps.value.length);
const isFirstStep = computed(() => currentStepIndex.value === 0);
const isLastStep = computed(() => currentStepIndex.value === totalSteps.value - 1);
const progressPercent = computed(() => Math.round(((currentStepIndex.value + 1) / totalSteps.value) * 100));

const hasActiveSpotlight = computed(() => {
  return Boolean(
    props.open &&
      currentStep.value?.placement !== 'center' &&
      spotlightRect.value &&
      spotlightRect.value.width > 0 &&
      spotlightRect.value.height > 0 &&
      viewportWidth.value >= 640,
  );
});

const spotlightBoxStyle = computed(() => {
  if (!hasActiveSpotlight.value || !spotlightRect.value) return {};
  const pad = 6;
  return {
    top: `${Math.max(4, spotlightRect.value.top - pad)}px`,
    left: `${Math.max(4, spotlightRect.value.left - pad)}px`,
    width: `${spotlightRect.value.width + pad * 2}px`,
    height: `${spotlightRect.value.height + pad * 2}px`,
    boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.64)',
  };
});

const floatingCardStyle = computed(() => {
  if (!hasActiveSpotlight.value || !spotlightRect.value) return {};
  const vw = viewportWidth.value;
  const vh = viewportHeight.value;
  const cardW = Math.min(430, vw - 32);
  const estimatedH = cardEl.value?.offsetHeight || 310;
  const rect = spotlightRect.value;
  const gap = 16;

  // Prefer below target; flip above if not enough space below
  let top = rect.bottom + gap;
  if (top + estimatedH > vh - 16 && rect.top - gap - estimatedH >= 16) {
    top = rect.top - gap - estimatedH;
  } else if (top + estimatedH > vh - 16) {
    top = Math.max(16, vh - estimatedH - 16);
  }

  const preferredLeft = rect.left + rect.width / 2 - cardW / 2;
  const left = Math.max(16, Math.min(preferredLeft, vw - cardW - 16));

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(cardW)}px`,
  };
});

function measureTarget() {
  if (typeof window === 'undefined' || !props.open) {
    spotlightRect.value = null;
    return;
  }
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;

  const selector = currentStep.value?.targetSelector;
  if (!selector || currentStep.value?.placement === 'center') {
    spotlightRect.value = null;
    return;
  }

  const el = document.querySelector(selector);
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    spotlightRect.value = null;
    return;
  }

  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) {
    spotlightRect.value = null;
    return;
  }

  spotlightRect.value = {
    top: r.top,
    left: r.left,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

let measureTimer = null;

async function syncStepContext() {
  if (!props.open) return;
  const step = currentStep.value;
  if (step?.tab) {
    emit('select-tab', step.tab);
  }
  await nextTick();
  if (typeof window !== 'undefined' && step?.targetSelector && step.placement !== 'center') {
    const el = document.querySelector(step.targetSelector);
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // ignore smooth scroll unsupported in minimal environments
      }
    }
  }
  measureTarget();
  clearTimeout(measureTimer);
  measureTimer = setTimeout(measureTarget, 220);
}

function goToStep(index) {
  if (index < 0 || index >= totalSteps.value) return;
  currentStepIndex.value = index;
}

function nextStep() {
  if (isLastStep.value) {
    finishTour();
    return;
  }
  currentStepIndex.value += 1;
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value -= 1;
  }
}

function skipTour() {
  emit('close', { reason: 'skipped' });
}

function finishTour(targetTab = 'custody') {
  emit('complete', { targetTab });
}

function handleKeydown(event) {
  if (!props.open) return;
  const target = event.target;
  const tag = String(target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (target?.closest?.('[role="tablist"]')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    skipTour();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    nextStep();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    prevStep();
  }
}

function attachWindowListeners() {
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', measureTarget);
  window.addEventListener('scroll', measureTarget, true);
  window.addEventListener('keydown', handleKeydown);
}

function detachWindowListeners() {
  if (typeof window === 'undefined') return;
  window.removeEventListener('resize', measureTarget);
  window.removeEventListener('scroll', measureTarget, true);
  window.removeEventListener('keydown', handleKeydown);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      currentStepIndex.value = 0;
      attachWindowListeners();
      syncStepContext();
    } else {
      clearTimeout(measureTimer);
      spotlightRect.value = null;
      detachWindowListeners();
    }
  },
  { immediate: true },
);

watch(currentStepIndex, () => {
  if (props.open) {
    syncStepContext();
  }
});

onBeforeUnmount(() => {
  clearTimeout(measureTimer);
  detachWindowListeners();
});
</script>

<template>
  <div
    v-if="open"
    data-testid="portal-first-access-tour"
    class="fixed inset-0 z-50"
  >
    <!-- Dimmed Backdrop (when centered or mobile fallback) -->
    <div
      v-if="!hasActiveSpotlight"
      class="fixed inset-0 bg-slate-950/65 backdrop-blur-[2px] transition-opacity"
      @click="skipTour"
    />

    <!-- Interactive Spotlight Cutout Ring (desktop anchored steps) -->
    <template v-else>
      <div
        class="fixed inset-0"
        aria-hidden="true"
        @click="skipTour"
      />
      <div
        data-testid="tour-spotlight-ring"
        class="fixed rounded-2xl ring-2 ring-brand-ring transition-all duration-300 pointer-events-none"
        :style="spotlightBoxStyle"
      />
    </template>

    <!-- Tour Card (Centered Executive Modal OR Floating Anchored Tooltip) -->
    <div
      :class="
        hasActiveSpotlight
          ? 'fixed z-10 transition-all duration-300'
          : 'fixed inset-0 z-10 flex items-center justify-center p-4 pointer-events-none'
      "
      :style="hasActiveSpotlight ? floatingCardStyle : undefined"
    >
      <div
        ref="cardEl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-tour-title"
        aria-describedby="portal-tour-desc"
        :data-step-id="currentStep.id"
        class="pointer-events-auto w-full rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        :class="hasActiveSpotlight ? '' : 'max-w-lg'"
        @click.stop
      >
        <!-- Top Brand Progress Bar -->
        <div class="h-1.5 w-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
          <div
            class="h-full bg-brand transition-all duration-300"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>

        <!-- Card Header -->
        <div class="px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-slate-100 dark:border-zinc-800/80">
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-xl bg-brand/10 text-brand-text-light dark:text-brand-text-dark border border-brand-ring/25 flex items-center justify-center shrink-0"
            >
              <PortalIcon :name="currentStep.icon" :size="20" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="text-[11px] font-bold uppercase tracking-wider text-brand-text-light dark:text-brand-text-dark"
                >
                  {{ currentStep.badge }}
                </span>
                <span class="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                  {{ currentStepIndex + 1 }}/{{ totalSteps }}
                </span>
              </div>
              <h2
                id="portal-tour-title"
                class="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-[#fafafa] leading-snug mt-0.5"
              >
                {{ currentStep.title }}
              </h2>
            </div>
          </div>

          <button
            type="button"
            data-testid="tour-close-btn"
            aria-label="Fechar tour guiado"
            title="Fechar tour (Esc)"
            class="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            @click="skipTour"
          >
            <PortalIcon name="x" :size="16" />
          </button>
        </div>

        <!-- Card Body -->
        <div class="px-5 py-4 space-y-3.5 overflow-y-auto text-xs sm:text-sm">
          <p
            id="portal-tour-desc"
            class="text-slate-600 dark:text-slate-300 leading-relaxed"
          >
            {{ currentStep.description }}
          </p>

          <!-- Contextual Callout Banner (e.g., pending CLT terms or linked assets) -->
          <div
            v-if="currentStep.callout"
            class="rounded-xl px-3.5 py-2.5 text-xs font-semibold flex items-center gap-2 border"
            :class="
              currentStep.callout.tone === 'amber'
                ? 'bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-200'
                : 'bg-emerald-500/10 border-emerald-500/35 text-emerald-800 dark:text-emerald-200'
            "
          >
            <PortalIcon
              :name="currentStep.callout.tone === 'amber' ? 'clipboard-check' : 'check-circle'"
              :size="15"
              class="shrink-0"
            />
            <span>{{ currentStep.callout.text }}</span>
          </div>

          <!-- Welcome 4-Pillar Grid -->
          <div
            v-if="currentStep.highlights"
            class="grid grid-cols-2 gap-2.5 pt-1"
          >
            <div
              v-for="item in currentStep.highlights"
              :key="item.label"
              class="rounded-xl border border-slate-200/90 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 p-2.5 flex items-start gap-2"
            >
              <span
                class="w-7 h-7 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0 mt-0.5"
              >
                <PortalIcon :name="item.icon" :size="14" />
              </span>
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 dark:text-[#fafafa] leading-tight">
                  {{ item.label }}
                </p>
                <p class="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 leading-snug">
                  {{ item.text }}
                </p>
              </div>
            </div>
          </div>

          <!-- Cloud Features Mini-List -->
          <div
            v-if="currentStep.features"
            class="space-y-2"
          >
            <div
              v-for="feat in currentStep.features"
              :key="feat.title"
              class="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 p-2.5 flex items-start gap-2.5"
            >
              <span
                class="w-7 h-7 rounded-lg bg-brand/10 text-brand-text-light dark:text-brand-text-dark flex items-center justify-center shrink-0 mt-0.5"
              >
                <PortalIcon :name="feat.icon" :size="14" />
              </span>
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-900 dark:text-[#fafafa]">
                  {{ feat.title }}
                </p>
                <p class="text-[11px] text-slate-600 dark:text-zinc-400 leading-snug mt-0.5">
                  {{ feat.text }}
                </p>
              </div>
            </div>
          </div>

          <!-- Pro Tip Box -->
          <div
            v-if="currentStep.tip"
            class="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-900/70 px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2 leading-relaxed"
          >
            <PortalIcon name="info" :size="14" class="text-brand-text-light dark:text-brand-text-dark mt-0.5 shrink-0" />
            <span>{{ currentStep.tip }}</span>
          </div>

          <!-- Final Completion Checklist -->
          <ul
            v-if="currentStep.checklist"
            class="space-y-2 pt-1"
          >
            <li
              v-for="item in currentStep.checklist"
              :key="item"
              class="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <span
                class="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5"
              >
                <PortalIcon name="check" :size="12" />
              </span>
              <span class="leading-snug">{{ item }}</span>
            </li>
          </ul>
        </div>

        <!-- Card Footer: Step Dots + Navigation Controls -->
        <div class="px-5 py-3.5 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 space-y-3">
          <!-- Clickable Step Progress Dots -->
          <div class="flex items-center justify-center gap-1.5" role="tablist" aria-label="Etapas do tour">
            <button
              v-for="(step, idx) in steps"
              :key="step.id"
              type="button"
              :aria-label="`Ir para etapa ${idx + 1}: ${step.title}`"
              :aria-current="idx === currentStepIndex ? 'step' : undefined"
              class="h-2 rounded-full transition-all cursor-pointer"
              :class="
                idx === currentStepIndex
                  ? 'w-6 bg-brand'
                  : idx < currentStepIndex
                    ? 'w-2 bg-brand/45 hover:bg-brand/70'
                    : 'w-2 bg-slate-300 dark:bg-zinc-700 hover:bg-slate-400'
              "
              @click="goToStep(idx)"
            />
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <button
                v-if="isFirstStep"
                type="button"
                data-testid="tour-skip-btn"
                class="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                @click="skipTour"
              >
                Pular por enquanto
              </button>
              <button
                v-else
                type="button"
                data-testid="tour-prev-btn"
                class="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                @click="prevStep"
              >
                <PortalIcon name="arrow-left" :size="14" />
                <span>Voltar</span>
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <template v-if="isLastStep">
                <button
                  v-if="pendingTermsCount > 0"
                  type="button"
                  data-testid="tour-goto-terms-btn"
                  class="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  @click="finishTour('terms')"
                >
                  <PortalIcon name="clipboard-check" :size="14" />
                  <span>Assinar Termo Pendente</span>
                </button>
                <button
                  type="button"
                  data-testid="tour-finish-btn"
                  class="min-h-[38px] px-4 py-1.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  @click="finishTour('custody')"
                >
                  <PortalIcon name="check" :size="14" />
                  <span>{{ pendingTermsCount > 0 ? 'Concluir Tour' : 'Começar a usar o Portal' }}</span>
                </button>
              </template>

              <button
                v-else
                type="button"
                data-testid="tour-next-btn"
                class="min-h-[38px] px-4 py-1.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                @click="nextStep"
              >
                <span>{{ isFirstStep ? 'Começar Tour' : 'Próximo' }}</span>
                <PortalIcon name="arrow-right" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
