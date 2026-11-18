<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PortalIcon from './PortalIcon.vue';
import { getStoredSession, portalApi } from '../services/nexusApi';
import { evaluateCellValue, evaluateSheetFormulas } from '../../../src/utils/sheetFormulaEngine';

const props = defineProps({
  user: { type: Object, default: () => ({}) },
  userEmail: { type: String, default: '' },
  userDepartment: { type: String, default: '' },
  wsState: { type: String, default: 'disconnected' },
  liveSheetEvent: { type: Object, default: null },
  streamHandle: { type: Object, default: null },
});

const nodes = ref([]);
const loading = ref(false);
const errorBanner = ref('');
const planUpgradeNotice = ref('');
const currentFolderId = ref(null);
const newFolderName = ref('');
const previewNode = ref(null);

// Nexus Sheets Live state
const activeSheetNode = ref(null);
const sheetRev = ref(1);
const sheetTabs = ref([
  {
    name: 'Planilha1',
    freezeRow: 1,
    columns: ['A', 'B', 'C', 'D', 'E', 'F'],
    cells: {
      A1: { value: '100', formula: null },
      A2: { value: '250', formula: null },
      B1: { value: '350', formula: '=SOMA(A1:A2)' },
    },
  },
]);
const activeSheetTabIdx = ref(0);
const selectedCellRef = ref('A1');
const formulaInput = ref('100');
const sheetPeers = ref([]);
const remoteCursors = ref({});

let ownWsHandle = null;

const resolvedEmail = computed(() => {
  return String(
    props.userEmail ||
      props.user?.email ||
      getStoredSession()?.user?.email ||
      '',
  )
    .toLowerCase()
    .trim();
});

const resolvedDepartment = computed(() => {
  return String(
    props.userDepartment ||
      props.user?.department ||
      getStoredSession()?.user?.department ||
      '',
  ).trim();
});

function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

// Collaborator ACL visibility filter
const visibleNodes = computed(() => {
  return nodes.value.filter((n) => {
    const eff = String(n.effectiveAccess || n.effective_access || n.accessLevel || '').toLowerCase();
    if (eff === 'none') return false;
    const vPath = String(n.virtualPath || n.virtual_path || '');
    if (vPath === '/Cofre-TI-Infra' || vPath.startsWith('/Cofre-TI-Infra/')) return false;
    if (vPath === '/Chamados' || vPath.startsWith('/Chamados/')) return false;
    if (currentFolderId.value) {
      return (n.parentId || n.parent_id) === currentFolderId.value;
    }
    return true;
  });
});

const currentFolderNode = computed(() => {
  if (!currentFolderId.value) return null;
  return nodes.value.find((n) => n.id === currentFolderId.value) || null;
});

const currentFolderAccess = computed(() => {
  if (currentFolderNode.value) {
    return String(
      currentFolderNode.value.effectiveAccess ||
        currentFolderNode.value.effective_access ||
        'editor',
    ).toLowerCase();
  }
  const writable = visibleNodes.value.some((n) =>
    ['editor', 'full_control'].includes(
      String(n.effectiveAccess || n.effective_access || '').toLowerCase(),
    ),
  );
  return writable ? 'editor' : 'reader';
});

const canWriteInCurrentFolder = computed(() => {
  return ['editor', 'full_control'].includes(currentFolderAccess.value);
});

function canDeleteNode(node) {
  const eff = String(node.effectiveAccess || node.effective_access || '').toLowerCase();
  if (eff === 'full_control') return true;
  if (eff === 'editor') {
    const creator = String(node.createdByEmail || node.created_by_email || '')
      .toLowerCase()
      .trim();
    if (!creator || !resolvedEmail.value) return false;
    return creator === resolvedEmail.value;
  }
  return false;
}

function canDownloadNode(node) {
  const eff = String(node.effectiveAccess || node.effective_access || 'reader').toLowerCase();
  return ['reader', 'editor', 'full_control'].includes(eff);
}

const evaluatedTabs = computed(() => evaluateSheetFormulas(sheetTabs.value));
const currentTab = computed(
  () => sheetTabs.value[activeSheetTabIdx.value] || sheetTabs.value[0],
);
const evaluatedCurrentTab = computed(
  () => evaluatedTabs.value[activeSheetTabIdx.value] || evaluatedTabs.value[0],
);

async function loadDriveNodes() {
  loading.value = true;
  errorBanner.value = '';
  planUpgradeNotice.value = '';
  try {
    const res = await portalApi.listStorageNodes();
    const list = res?.items || res?.nodes || [];
    nodes.value = list;
    const sheetCandidate = list.find(
      (n) =>
        /\.(xlsx|csv|nexusheet)$/i.test(String(n.name || '')) &&
        String(n.effectiveAccess || n.effective_access || '') !== 'none',
    );
    if (sheetCandidate && !activeSheetNode.value) {
      await openSheetEditor(sheetCandidate);
    }
  } catch (err) {
    if (err?.status === 403 || String(err?.code || '').includes('FEATURE_NOT_IN_PLAN')) {
      planUpgradeNotice.value =
        err?.message ||
        'O módulo Arquivos & Nuvem (Cloud Vault) não está habilitado no plano atual da empresa.';
    } else {
      errorBanner.value = err?.message || 'Não foi possível carregar os arquivos da nuvem corporativa.';
    }
  } finally {
    loading.value = false;
  }
}

async function handleCreateFolder() {
  const name = newFolderName.value.trim();
  if (!name) return;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    errorBanner.value = 'Nome de pasta inválido (Path Traversal bloqueado).';
    return;
  }
  errorBanner.value = '';
  try {
    const res = await portalApi.createStorageFolder({
      parentId: currentFolderId.value,
      name,
    });
    const created = res?.node || res?.folder || res;
    if (created?.id) {
      nodes.value = [...nodes.value, created];
    }
    newFolderName.value = '';
  } catch (err) {
    errorBanner.value = err?.message || 'Erro ao criar pasta.';
  }
}

async function handleUploadFile(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  errorBanner.value = '';
  try {
    const res = await portalApi.uploadStorageFile(file, {
      parentId: currentFolderId.value,
      fileName: file.name,
      conflictPolicy: 'version',
    });
    const created = res?.node || res;
    if (created?.id) {
      nodes.value = [...nodes.value.filter((n) => n.id !== created.id), created];
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Falha no upload do arquivo (verifique cota ou bloqueio).';
  }
}

async function handlePreviewFile(node) {
  errorBanner.value = '';
  try {
    await portalApi.previewStorageFile(node.id);
    previewNode.value = node;
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao abrir preview online.';
  }
}

async function handleDownloadFile(node) {
  if (!canDownloadNode(node)) {
    errorBanner.value = 'Perfil viewer_online permite apenas visualização online.';
    return;
  }
  errorBanner.value = '';
  try {
    await portalApi.downloadStorageFile(node.id);
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao baixar arquivo.';
  }
}

async function handleDeleteFile(node) {
  if (!canDeleteNode(node)) {
    errorBanner.value = 'Você só pode excluir arquivos enviados por você mesmo.';
    return;
  }
  errorBanner.value = '';
  try {
    await portalApi.deleteStorageNode(node.id);
    nodes.value = nodes.value.filter((n) => n.id !== node.id);
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao excluir arquivo.';
  }
}

function getActiveWsHandle() {
  return props.streamHandle || ownWsHandle;
}

async function openSheetEditor(node) {
  activeSheetNode.value = node;
  try {
    const res = await portalApi.getSheet(node.id);
    const tabs = res?.sheets || res?.tabs || res?.workbook?.sheets;
    if (Array.isArray(tabs) && tabs.length > 0) {
      sheetTabs.value = evaluateSheetFormulas(tabs);
    }
    if (res?.rev) sheetRev.value = Number(res.rev);
    getActiveWsHandle()?.joinSheet?.(node.id);
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível abrir a planilha.';
  }
}

function selectSheetCell(cellRef) {
  selectedCellRef.value = cellRef;
  const cell = currentTab.value?.cells?.[cellRef] || {};
  formulaInput.value =
    cell.formula || (cell.value !== undefined && cell.value !== null ? String(cell.value) : '');
  if (activeSheetNode.value?.id) {
    getActiveWsHandle()?.sendSheetCursor?.({
      fileId: activeSheetNode.value.id,
      tab: currentTab.value.name,
      tabName: currentTab.value.name,
      cell: cellRef,
      cellRef,
    });
  }
}

function applySheetCellInput(cellRef, rawValue) {
  const str = String(rawValue ?? '');
  const isFormula = str.trim().startsWith('=');
  sheetTabs.value = evaluateSheetFormulas(
    sheetTabs.value.map((t, idx) => {
      if (idx !== activeSheetTabIdx.value) return t;
      const nextCells = { ...(t.cells || {}) };
      nextCells[cellRef] = {
        ...(nextCells[cellRef] || {}),
        formula: isFormula ? str.trim() : null,
        value: isFormula ? evaluateCellValue(str.trim(), t.cells || {}, sheetTabs.value) : str,
      };
      return { ...t, cells: nextCells };
    }),
  );

  if (activeSheetNode.value?.id) {
    getActiveWsHandle()?.sendSheetCellPatch?.({
      fileId: activeSheetNode.value.id,
      tab: currentTab.value.name,
      tabName: currentTab.value.name,
      cell: cellRef,
      cellRef,
      value: isFormula ? undefined : str,
      formula: isFormula ? str.trim() : null,
      baseRev: sheetRev.value,
    });
  }
}

async function saveActiveSheet() {
  if (!activeSheetNode.value?.id) return;
  try {
    const res = await portalApi.saveSheet(activeSheetNode.value.id, {
      expectedRev: sheetRev.value,
      sheets: evaluatedTabs.value,
      tabs: evaluatedTabs.value,
    });
    if (res?.rev) sheetRev.value = Number(res.rev);
  } catch (err) {
    errorBanner.value = err?.message || 'Erro ao salvar planilha (bloqueada ou conflito de revisão).';
  }
}

function handleIncomingSheetFrame(frame) {
  if (!frame) return;
  const evt = String(frame.event || frame.type || '');
  const data = frame.data || frame;
  if (evt === 'sheet.snapshot' && Array.isArray(data.tabs || data.sheets)) {
    sheetTabs.value = evaluateSheetFormulas(data.tabs || data.sheets);
    if (data.rev) sheetRev.value = Number(data.rev);
  } else if (evt === 'sheet.presence' && Array.isArray(data.peers)) {
    sheetPeers.value = data.peers;
  } else if (evt === 'sheet.cursor' && (data.cellRef || data.cell)) {
    const ref = data.cellRef || data.cell;
    remoteCursors.value = {
      ...remoteCursors.value,
      [data.userEmail || data.email || 'peer']: {
        userEmail: data.userEmail || data.email,
        userName: data.userName || data.name || data.userEmail,
        tabName: data.tabName || data.tab || 'Planilha1',
        cellRef: ref,
      },
    };
  } else if (evt === 'sheet.cell.patch' && (data.cellRef || data.cell)) {
    const ref = data.cellRef || data.cell;
    const targetTab = data.tabName || data.tab || sheetTabs.value[0]?.name || 'Planilha1';
    sheetTabs.value = evaluateSheetFormulas(
      sheetTabs.value.map((t) => {
        if (t.name !== targetTab) return t;
        const nextCells = { ...(t.cells || {}) };
        nextCells[ref] = {
          ...(nextCells[ref] || {}),
          value: data.value !== undefined ? String(data.value) : nextCells[ref]?.value,
          formula: data.formula !== undefined ? data.formula : nextCells[ref]?.formula || null,
        };
        return { ...t, cells: nextCells };
      }),
    );
    if (data.rev) sheetRev.value = Number(data.rev);
  } else if (evt === 'sheet.saved' && data.rev) {
    sheetRev.value = Number(data.rev);
  }
}

watch(
  () => props.liveSheetEvent,
  (ev) => {
    if (ev) handleIncomingSheetFrame(ev);
  },
  { deep: true },
);

onMounted(async () => {
  if (!props.streamHandle) {
    const stored = getStoredSession();
    if (stored?.token && typeof portalApi.connectRealtimeStream === 'function') {
      ownWsHandle = portalApi.connectRealtimeStream(stored.token, (frame) => {
        if (String(frame?.event || '').startsWith('sheet.')) {
          handleIncomingSheetFrame(frame);
        }
      });
    }
  }
  await loadDriveNodes();
});

onBeforeUnmount(() => {
  if (ownWsHandle) {
    ownWsHandle.disconnect?.();
    ownWsHandle = null;
  }
});
</script>

<template>
  <div class="space-y-5">
    <!-- Header Banner -->
    <div class="station-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-text-light dark:text-brand-text-dark">
          <PortalIcon name="hard-drive" :size="16" />
          <span>Nexus Cloud Drive • {{ resolvedDepartment || 'Corporativo' }}</span>
        </div>
        <h2 class="text-lg font-bold text-slate-900 dark:text-[#fafafa] mt-1">
          Arquivos &amp; Nuvem Corporativa
        </h2>
        <p class="text-xs text-slate-600 dark:text-slate-300">
          Acesse pastas públicas, arquivos do seu setor, seu espaço pessoal e coedite planilhas Nexus Sheets em tempo real.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="currentFolderId"
          type="button"
          class="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold"
          @click="currentFolderId = null"
        >
          Voltar para Raiz (/)
        </button>
        <button
          type="button"
          class="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold inline-flex items-center gap-1.5"
          @click="loadDriveNodes"
        >
          <PortalIcon name="refresh-cw" :size="14" />
          <span>Atualizar</span>
        </button>
      </div>
    </div>

    <!-- Plan upgrade or error banners -->
    <div
      v-if="planUpgradeNotice"
      role="alert"
      data-testid="cloud-plan-notice"
      class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-semibold text-amber-800 dark:text-amber-200"
    >
      {{ planUpgradeNotice }}
    </div>

    <div
      v-if="errorBanner"
      role="alert"
      data-testid="cloud-error-banner"
      class="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs font-semibold text-rose-700 dark:text-rose-300"
    >
      {{ errorBanner }}
    </div>

    <!-- Folder & Upload Controls (only when user has editor/full_control access) -->
    <div
      v-if="!planUpgradeNotice && canWriteInCurrentFolder"
      class="station-panel p-4 flex flex-wrap items-center justify-between gap-3"
    >
      <form class="flex items-center gap-2" @submit.prevent="handleCreateFolder">
        <input
          v-model="newFolderName"
          type="text"
          aria-label="Nova pasta"
          placeholder="Nome da nova pasta..."
          class="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
        />
        <button
          type="submit"
          class="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-brand text-brand-fg text-xs font-bold inline-flex items-center gap-1.5"
        >
          <PortalIcon name="plus" :size="15" />
          <span>Criar Pasta</span>
        </button>
      </form>

      <label
        class="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand-text-light dark:text-brand-text-dark text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
      >
        <PortalIcon name="paperclip" :size="15" />
        <span>Enviar Arquivo</span>
        <input
          type="file"
          aria-label="Enviar arquivo para a nuvem"
          class="hidden"
          @change="handleUploadFile"
        />
      </label>
    </div>

    <!-- VFS Node List -->
    <div v-if="!planUpgradeNotice" class="station-panel divide-y divide-slate-100 dark:divide-zinc-800">
      <div v-if="loading && visibleNodes.length === 0" class="p-8 text-center text-xs text-slate-500">
        Carregando arquivos da nuvem corporativa…
      </div>
      <div v-else-if="visibleNodes.length === 0" class="p-8 text-center text-xs text-slate-500">
        Nenhum arquivo ou pasta disponível neste diretório.
      </div>
      <div
        v-for="node in visibleNodes"
        :key="node.id"
        :data-testid="`portal-node-${node.name}`"
        class="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-zinc-900/50"
      >
        <div class="flex items-center gap-3 min-w-0">
          <PortalIcon
            v-if="(node.nodeType || node.node_type || node.type) === 'folder'"
            name="package"
            :size="18"
          />
          <PortalIcon
            v-else
            name="file-text"
            :size="18"
          />
          <div class="min-w-0">
            <button
              type="button"
              class="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#fafafa] hover:underline truncate block text-left"
              @click="
                (node.nodeType || node.node_type || node.type) === 'folder'
                  ? (currentFolderId = node.id)
                  : /\.(xlsx|csv|nexusheet)$/i.test(node.name)
                    ? openSheetEditor(node)
                    : handlePreviewFile(node)
              "
            >
              {{ node.name }}
            </button>
            <span class="text-[11px] font-mono text-slate-500 block">
              {{ (node.nodeType || node.node_type || node.type) === 'folder' ? 'Pasta' : formatBytes(node.sizeBytes || node.size_bytes) }}
              • Permissão: {{ node.effectiveAccess || node.effective_access || 'reader' }}
            </span>
          </div>

          <span
            v-if="node.lockedByEmail || node.locked_by_email"
            :data-testid="`portal-lock-${node.id}`"
            class="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[11px] font-bold inline-flex items-center gap-1"
          >
            <PortalIcon name="lock" :size="11" />
            <span>Em edição por {{ node.lockedByEmail || node.locked_by_email }}</span>
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <template v-if="(node.nodeType || node.node_type || node.type) !== 'folder'">
            <button
              type="button"
              class="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-semibold inline-flex items-center gap-1"
              @click="handlePreviewFile(node)"
            >
              <PortalIcon name="eye" :size="13" />
              <span>Visualizar</span>
            </button>

            <button
              v-if="/\.(xlsx|csv|nexusheet)$/i.test(node.name)"
              type="button"
              class="px-2.5 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1"
              @click="openSheetEditor(node)"
            >
              <PortalIcon name="file-text" :size="13" />
              <span>Abrir Planilha</span>
            </button>

            <button
              v-if="canDownloadNode(node)"
              type="button"
              :data-testid="`portal-download-${node.id}`"
              class="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-semibold inline-flex items-center gap-1"
              @click="handleDownloadFile(node)"
            >
              <PortalIcon name="download" :size="13" />
              <span>Baixar</span>
            </button>
          </template>

          <button
            v-if="canDeleteNode(node)"
            type="button"
            :data-testid="`portal-delete-${node.id}`"
            class="px-2.5 py-1.5 rounded-xl border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold inline-flex items-center gap-1"
            @click="handleDeleteFile(node)"
          >
            <PortalIcon name="trash-2" :size="13" />
            <span>Excluir</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Online Preview Panel -->
    <div
      v-if="previewNode"
      data-testid="portal-preview-panel"
      class="station-panel p-4 flex items-center justify-between"
    >
      <span class="text-xs font-bold">Visualização Online — {{ previewNode.name }}</span>
      <button type="button" class="text-xs font-bold text-rose-500" @click="previewNode = null">
        Fechar
      </button>
    </div>

    <!-- Embedded Nexus Sheets Live Co-Editor -->
    <div v-if="!planUpgradeNotice" class="station-panel p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <PortalIcon name="file-text" :size="18" />
          <h3 class="text-sm font-bold text-slate-900 dark:text-[#fafafa]">
            Nexus Sheets Live — {{ activeSheetNode?.name || 'Planilha Colaborativa' }}
          </h3>
          <span class="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
            rev #{{ sheetRev }}
          </span>
        </div>

        <button
          type="button"
          class="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold"
          @click="saveActiveSheet"
        >
          Salvar Planilha
        </button>
      </div>

      <!-- Formula Bar -->
      <div class="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 p-2 rounded-xl border border-slate-200 dark:border-zinc-800">
        <span class="px-2.5 py-1 rounded bg-white dark:bg-zinc-800 font-mono text-xs font-bold border border-slate-200 dark:border-zinc-700">
          {{ selectedCellRef }}
        </span>
        <span class="font-mono text-xs font-bold text-slate-400">fx</span>
        <input
          v-model="formulaInput"
          type="text"
          aria-label="Barra de Fórmulas da Planilha"
          data-testid="portal-formula-input"
          placeholder="Valor ou fórmula (=SOMA(A1:A2))"
          class="flex-1 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-xs"
          @input="applySheetCellInput(selectedCellRef, formulaInput)"
        />
      </div>

      <!-- Grid -->
      <div class="overflow-x-auto border border-slate-200 dark:border-zinc-800 rounded-xl">
        <table class="w-full border-collapse text-xs font-mono">
          <thead>
            <tr class="bg-slate-100 dark:bg-zinc-900">
              <th class="w-10 border border-slate-200 dark:border-zinc-800 py-1 text-center">#</th>
              <th
                v-for="col in ['A', 'B', 'C', 'D']"
                :key="col"
                class="min-w-[110px] border border-slate-200 dark:border-zinc-800 py-1 px-2 text-center font-bold"
              >
                {{ col }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rowNum in [1, 2, 3, 4, 5]" :key="rowNum">
              <td class="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center font-bold text-slate-500">
                {{ rowNum }}
              </td>
              <td
                v-for="col in ['A', 'B', 'C', 'D']"
                :key="`${col}${rowNum}`"
                :data-testid="`portal-cell-${col}${rowNum}`"
                class="border border-slate-200 dark:border-zinc-800 p-0 relative"
                @click="selectSheetCell(`${col}${rowNum}`)"
              >
                <input
                  type="text"
                  :aria-label="`Célula ${col}${rowNum}`"
                  :value="
                    selectedCellRef === `${col}${rowNum}`
                      ? formulaInput
                      : evaluatedCurrentTab?.cells?.[`${col}${rowNum}`]?.value ?? ''
                  "
                  class="w-full h-8 px-2 bg-transparent focus:outline-none text-xs font-mono"
                  @focus="selectSheetCell(`${col}${rowNum}`)"
                  @input="
                    (e) => {
                      formulaInput = e.target.value;
                      applySheetCellInput(`${col}${rowNum}`, e.target.value);
                    }
                  "
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
