// src/pages/CloudVaultHub.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  KeyRound,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Terminal,
  Trash2,
  Unlock,
  UploadCloud,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { can, isSuperadmin } from '../utils/permissions';
import { hasFeature } from '../utils/entitlements';
import { getGatewayBaseUrl, microservicesApi } from '../services/microservicesClient';
import { evaluateCellValue, evaluateSheetFormulas } from '../utils/sheetFormulaEngine';
import VpsOnboardingTutorial from '../components/cloud/VpsOnboardingTutorial';
import WindowsFileExplorer from '../components/cloud/WindowsFileExplorer';
import { DesktopSyncGuideModal, DesktopSyncStatusModal } from '../components/cloud/DesktopSyncModal';

function triggerBrowserDownload(blob, fileName) {
  if (!blob || typeof window === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'arquivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const DEFAULT_SHEET_TABS = [
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
];

const ACL_LEVEL_LABELS = {
  none: 'Bloqueado (none)',
  viewer_online: 'Somente Visualização Online (viewer_online)',
  reader: 'Leitor + Download (reader)',
  editor: 'Editor (editor)',
  full_control: 'Controle Total (full_control)',
};

const CloudVaultHub = () => {
  const { currentUser } = useAuth();
  const canConnect = can(currentUser, 'cloud:connect');
  const canManageAcl = can(currentUser, 'cloud:acl');
  const canWrite = can(currentUser, 'cloud:write');
  const canRead = can(currentUser, 'cloud:read');
  const zeroKnowledgeBlocked =
    isSuperadmin(currentUser) ||
    currentUser?.role === 'superadmin' ||
    currentUser?.tenantId === 'nexus-master';
  const planEntitled = hasFeature(currentUser, 'cloud_storage');

  const [activeTab, setActiveTab] = useState('connection');
  const [, setLoading] = useState(false);

  // Tab 1: Connection & Telemetry
  const [connForm, setConnForm] = useState({
    providerType: 'sftp',
    label: 'VPS Corporativa Principal',
    host: '',
    port: 22,
    username: 'nexusvault',
    password: '',
    privateKey: '',
    endpointUrl: '',
    hmacToken: '',
    bucket: '',
    region: 'us-east-1',
    accessKey: '',
    secretKey: '',
    rootPath: '/srv/nexus-vault',
    quotaBytes: 53687091200,
  });
  const [connStatus, setConnStatus] = useState(null);
  const [healthInfo, setHealthInfo] = useState(null);
  const [quotaInfo, setQuotaInfo] = useState({
    quotaBytes: 53687091200,
    usedBytes: 0,
    usagePercent: 0,
    alertLevel: 'normal',
    byDepartment: [],
  });
  const [installScriptData, setInstallScriptData] = useState(null);

  // Tab 2: Explorer VFS
  const [nodes, setNodes] = useState([]);
  const [trashNodes, setTrashNodes] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
  const [nodeVersions, setNodeVersions] = useState([]);
  const [previewInfo, setPreviewInfo] = useState(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [desktopSyncSession, setDesktopSyncSession] = useState(null);
  const [desktopSyncBusy, setDesktopSyncBusy] = useState(false);
  const [desktopSlowHint, setDesktopSlowHint] = useState(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState(false);
  const desktopPollRef = useRef(null);
  const desktopHintRef = useRef(null);

  // Tab 3: ACL & Audit
  const [aclNodeId, setAclNodeId] = useState('');
  const [aclRules, setAclRules] = useState([]);
  const [aclForm, setAclForm] = useState({
    targetType: 'department',
    targetValue: 'Financeiro',
    accessLevel: 'editor',
  });
  const [shareLinks, setShareLinks] = useState([]);
  const [showInactiveLinks, setShowInactiveLinks] = useState(false);
  const [shareLinkForm, setShareLinkForm] = useState({
    expiresInHours: 24,
    allowDownload: true,
    password: '',
  });
  const [auditEntries, setAuditEntries] = useState([]);
  const [chainStatus, setChainStatus] = useState(null);

  // Tab 4: Nexus Sheets Live
  const [activeSheetId, setActiveSheetId] = useState('');
  const [newSheetName, setNewSheetName] = useState('Orcamento-TI.xlsx');
  const [sheetTabs, setSheetTabs] = useState(DEFAULT_SHEET_TABS);
  const [activeSheetTabIdx, setActiveSheetTabIdx] = useState(0);
  const [selectedCellRef, setSelectedCellRef] = useState('A1');
  const [formulaInput, setFormulaInput] = useState('100');
  const [sheetRev, setSheetRev] = useState(1);
  const [sheetPeers, setSheetPeers] = useState([]);
  const [sheetCursors, setSheetCursors] = useState({});
  const [cellHistory, setCellHistory] = useState([]);
  const [newTabTitle, setNewTabTitle] = useState('');

  const wsHandleRef = useRef(null);

  const loadVaultOverview = useCallback(async () => {
    if (!canRead || zeroKnowledgeBlocked || !planEntitled) return;
    setLoading(true);
    try {
      const [nodesRes, quotaRes, healthRes] = await Promise.all([
        microservicesApi.listStorageNodes().catch(() => ({ items: [] })),
        microservicesApi.getStorageQuota().catch(() => null),
        microservicesApi.getStorageHealth().catch(() => null),
      ]);

      const nodeItems = nodesRes?.items || nodesRes?.nodes || [];
      setNodes(nodeItems);
      if (!aclNodeId && nodeItems.length > 0) {
        setAclNodeId(nodeItems[0].id);
      }
      const firstSheet = nodeItems.find((n) =>
        /\.(xlsx|csv|nexusheet)$/i.test(String(n.name || '')),
      );
      if (firstSheet && !activeSheetId) {
        setActiveSheetId(firstSheet.id);
      }

      if (quotaRes) {
        const qBytes = Number(quotaRes.quotaBytes ?? 53687091200);
        const uBytes = Number(quotaRes.usedBytes ?? 0);
        const pct =
          quotaRes.usagePercent !== undefined
            ? Number(quotaRes.usagePercent)
            : qBytes > 0
              ? Math.round((uBytes / qBytes) * 1000) / 10
              : 0;
        const level =
          quotaRes.alertLevel ||
          (pct >= 90 ? 'critical_90' : pct >= 80 ? 'warning_80' : 'normal');
        setQuotaInfo({
          quotaBytes: qBytes,
          usedBytes: uBytes,
          usagePercent: pct,
          alertLevel: level,
          byDepartment: Array.isArray(quotaRes.byDepartment) ? quotaRes.byDepartment : [],
        });
      }

      if (healthRes) {
        setHealthInfo(healthRes);
      }

      if (canConnect) {
        const connRes = await microservicesApi.getStorageConnection().catch(() => null);
        const conn = connRes?.connection || connRes;
        if (conn && conn.configured !== false) {
          setConnStatus(conn);
          setConnForm((prev) => ({
            ...prev,
            providerType: conn.providerType || prev.providerType,
            label: conn.label || prev.label,
            host: conn.host || prev.host,
            port: conn.port ?? prev.port,
            username: conn.username || prev.username,
            endpointUrl: conn.endpointUrl || prev.endpointUrl,
            bucket: conn.bucket || prev.bucket,
            region: conn.region || prev.region,
            rootPath: conn.rootPath || prev.rootPath,
            quotaBytes: conn.quotaBytes ?? prev.quotaBytes,
            password: conn.credentialsMasked?.password || prev.password,
            hmacToken: conn.credentialsMasked?.hmacToken || prev.hmacToken,
          }));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [canRead, canConnect, zeroKnowledgeBlocked, planEntitled, aclNodeId, activeSheetId]);

  useEffect(() => {
    loadVaultOverview();
  }, [loadVaultOverview]);

  // Connect WebSocket for Nexus Sheets Live when on sheets tab or when activeSheetId is set
  useEffect(() => {
    if (zeroKnowledgeBlocked || !planEntitled) return undefined;
    if (typeof microservicesApi.openNexusDeskSocket !== 'function') return undefined;
    const handle = microservicesApi.openNexusDeskSocket({
      clientType: 'react19-console',
      onEvent: (msg) => {
        const ev = msg?.event || msg?.type;
        const data = msg?.data || msg || {};
        if (ev === 'sheet.snapshot' && Array.isArray(data.tabs || data.sheets)) {
          setSheetTabs(evaluateSheetFormulas(data.tabs || data.sheets));
          if (data.rev) setSheetRev(Number(data.rev));
        } else if (ev === 'sheet.presence' && Array.isArray(data.peers)) {
          setSheetPeers(data.peers);
        } else if (ev === 'sheet.cursor' && (data.cellRef || data.cell)) {
          const ref = data.cellRef || data.cell;
          setSheetCursors((prev) => ({
            ...prev,
            [data.userEmail || data.email || 'peer']: {
              userEmail: data.userEmail || data.email,
              userName: data.userName || data.name || data.userEmail,
              tabName: data.tabName || data.tab || 'Planilha1',
              cellRef: ref,
            },
          }));
        } else if (ev === 'sheet.cell.patch' && (data.cellRef || data.cell)) {
          const ref = data.cellRef || data.cell;
          setSheetTabs((prev) => {
            const targetTab = data.tabName || data.tab || prev[0]?.name || 'Planilha1';
            const next = prev.map((t) => {
              if (t.name !== targetTab) return t;
              const nextCells = { ...(t.cells || {}) };
              nextCells[ref] = {
                ...(nextCells[ref] || {}),
                value: data.value !== undefined ? String(data.value) : nextCells[ref]?.value,
                formula: data.formula !== undefined ? data.formula : nextCells[ref]?.formula || null,
              };
              return { ...t, cells: nextCells };
            });
            return evaluateSheetFormulas(next);
          });
          if (data.rev) setSheetRev(Number(data.rev));
        } else if (ev === 'sheet.saved') {
          if (data.rev) setSheetRev(Number(data.rev));
        }
      },
    });
    wsHandleRef.current = handle;
    return () => {
      handle?.close?.();
    };
  }, [zeroKnowledgeBlocked, planEntitled]);

  const currentSheetTab = useMemo(
    () => sheetTabs[activeSheetTabIdx] || sheetTabs[0] || DEFAULT_SHEET_TABS[0],
    [sheetTabs, activeSheetTabIdx],
  );

  const EvaluatedTabs = useMemo(() => evaluateSheetFormulas(sheetTabs), [sheetTabs]);
  const evaluatedCurrentTab = EvaluatedTabs[activeSheetTabIdx] || EvaluatedTabs[0] || DEFAULT_SHEET_TABS[0];

  const closePreviewInfo = useCallback(() => {
    setPreviewInfo((prev) => {
      if (prev?.objectUrl && typeof URL?.revokeObjectURL === 'function') {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      setPreviewInfo((prev) => {
        if (prev?.objectUrl && typeof URL?.revokeObjectURL === 'function') {
          URL.revokeObjectURL(prev.objectUrl);
        }
        return null;
      });
    };
  }, []);

  // Handlers Tab 1
  const handleSaveConnection = async (e) => {
    e?.preventDefault?.();
    if (!canConnect) {
      toast.error('Permissão insuficiente: requer cloud:connect.');
      return;
    }
    try {
      const credentials = {};
      const isPlainSecret = (v) =>
        typeof v === 'string' && v.trim() !== '' && !v.includes('*') && !v.includes('••••');
      if (isPlainSecret(connForm.password)) credentials.password = connForm.password;
      if (isPlainSecret(connForm.privateKey)) credentials.privateKey = connForm.privateKey;
      if (isPlainSecret(connForm.hmacToken)) credentials.hmacToken = connForm.hmacToken.trim();
      if (isPlainSecret(connForm.accessKey)) credentials.accessKey = connForm.accessKey;
      if (isPlainSecret(connForm.secretKey)) credentials.secretKey = connForm.secretKey;

      const payload = {
        providerType: connForm.providerType,
        label: connForm.label,
        host: connForm.host,
        port: Number(connForm.port || 22),
        username: connForm.username,
        rootPath: connForm.rootPath,
        endpointUrl: String(connForm.endpointUrl || '').trim(),
        bucket: connForm.bucket,
        region: connForm.region,
        quotaBytes: Number(connForm.quotaBytes || 53687091200),
        credentials,
      };
      const res = await microservicesApi.saveStorageConnection(payload);
      setConnStatus(res?.connection || res);
      toast.success('Configuração de conexão VPS salva com criptografia AES-256-GCM.');
    } catch (err) {
      toast.error(err?.message || 'Erro ao salvar configuração VPS.');
    }
  };

  const handleTestConnection = async () => {
    try {
      const res = await microservicesApi.testStorageConnection();
      setHealthInfo(res);
      if (res?.ok) {
        toast.success(`Conexão VPS saudável (${res.latencyMs ?? 0} ms).`);
      } else {
        toast.error(res?.error || 'Falha no teste de conexão VPS.');
      }
    } catch (err) {
      toast.error(err?.message || 'Falha ao testar conexão VPS.');
    }
  };

  const handleInitializeVault = async () => {
    try {
      const res = await microservicesApi.initializeStorageVault();
      toast.success(
        `Estrutura corporativa inicializada (${res?.provisioned?.length || 6} diretórios provisionados).`,
      );
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao inicializar estrutura na VPS.');
    }
  };

  const handleGenerateInstallScript = async (rotateToken = false) => {
    try {
      const res = await microservicesApi.generateStorageInstallScript({
        rootPath: connForm.rootPath,
        quotaBytes: connForm.quotaBytes,
        port: 9443,
        ...(rotateToken === true ? { rotateToken: true } : {}),
      });
      setInstallScriptData(res);
      toast.success(
        rotateToken === true
          ? 'Novo token HMAC gerado e script 1-Click atualizado.'
          : 'Script 1-Click do Nexus Storage Node gerado com token HMAC.',
      );
    } catch (err) {
      toast.error(err?.message || 'Falha ao gerar script 1-Click.');
    }
  };

  const handleCopyInstallScript = async () => {
    const text = installScriptData?.script || installScriptData?.installCommand;
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success('Script copiado para a área de transferência.');
      }
    } catch {
      toast.error('Não foi possível copiar automaticamente; selecione e copie o bloco abaixo.');
    }
  };

  // Handlers Tab 2 (Windows File Explorer)
  const handleCreateFolder = async (folderName, targetParentId = currentFolderId) => {
    const trimmed = String(folderName || '').trim();
    if (!trimmed) return false;
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
      toast.error('Nome de pasta inválido (Path Traversal bloqueado).');
      return false;
    }
    try {
      const res = await microservicesApi.createStorageFolder({
        parentId: targetParentId || null,
        name: trimmed,
      });
      const created = res?.node || res?.folder || res;
      if (created?.id) {
        setNodes((prev) => [...prev, created]);
      }
      toast.success(`Pasta "${trimmed}" criada na VPS.`);
      return true;
    } catch (err) {
      toast.error(err?.message || 'Erro ao criar pasta.');
      return false;
    }
  };

  const handleUploadFiles = async (fileList, targetParentId = currentFolderId) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingCount(files.length);
    let successCount = 0;
    try {
      for (const file of files) {
        try {
          const res = await microservicesApi.uploadStorageFile(file, {
            parentId: targetParentId || null,
            fileName: file.name,
            conflictPolicy: 'version',
          });
          const uploaded = res?.node || res;
          if (uploaded?.id) {
            setNodes((prev) => {
              const exists = prev.some((n) => n.id === uploaded.id);
              return exists ? prev.map((n) => (n.id === uploaded.id ? uploaded : n)) : [...prev, uploaded];
            });
          }
          successCount += 1;
        } catch (err) {
          toast.error(`Falha ao enviar "${file.name}": ${err?.message || 'erro no upload.'}`);
        }
      }
      if (successCount > 0) {
        toast.success(
          successCount === 1
            ? `Arquivo "${files[0].name}" enviado para a VPS.`
            : `${successCount} arquivos enviados para a VPS.`,
        );
        await loadVaultOverview();
      }
    } finally {
      setUploadingCount(0);
    }
  };

  const handleRenameNode = async (node, newName) => {
    try {
      const res = await microservicesApi.updateStorageNode(node.id, { name: newName });
      const updated = res?.node || res;
      if (updated?.id) {
        setNodes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      }
      toast.success(`Renomeado para "${newName}".`);
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao renomear item.');
    }
  };

  const handleMoveNode = async (node, targetParentId) => {
    try {
      await microservicesApi.updateStorageNode(node.id, { parentId: targetParentId ?? null });
      toast.success(`"${node.name}" movido com sucesso.`);
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao mover item.');
    }
  };

  const handleCopyNode = async (node, targetParentId, explicitName) => {
    try {
      const payload = { targetParentId: targetParentId ?? null };
      if (explicitName) payload.name = explicitName;
      await microservicesApi.copyStorageNode(node.id, payload);
      toast.success(`Cópia de "${node.name}" criada com sucesso.`);
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao copiar item.');
    }
  };

  const handleDownloadNode = async (node) => {
    if (node.effectiveAccess === 'viewer_online') {
      toast.error('Perfil viewer_online permite apenas visualização online (download bloqueado).');
      return;
    }
    try {
      const res = await microservicesApi.downloadStorageFile(node.id);
      if (res?.blob) {
        triggerBrowserDownload(res.blob, node.name);
      }
      toast.success(`Download de "${node.name}" iniciado.`);
    } catch (err) {
      toast.error(err?.message || 'Falha ao baixar arquivo.');
    }
  };

  const handlePreviewNode = async (node) => {
    try {
      const res = await microservicesApi.previewStorageFile(node.id);
      const contentType = res?.contentType || node.mimeType || 'application/octet-stream';
      let objectUrl = null;
      let textContent = null;

      if (res?.blob) {
        const lowerCt = String(contentType).toLowerCase();
        const isText =
          lowerCt.startsWith('text/') ||
          lowerCt.includes('json') ||
          lowerCt.includes('xml') ||
          /\.(txt|md|json|csv|log|xml|ini|yml|yaml)$/i.test(String(node.name || ''));
        if (isText && typeof res.blob.text === 'function') {
          textContent = await res.blob.text();
        } else if (typeof URL?.createObjectURL === 'function') {
          objectUrl = URL.createObjectURL(res.blob);
        }
      }

      setActiveNode(node);
      setPreviewInfo((prev) => {
        if (prev?.objectUrl && typeof URL?.revokeObjectURL === 'function') {
          URL.revokeObjectURL(prev.objectUrl);
        }
        return { node, contentType, objectUrl, textContent };
      });
    } catch (err) {
      toast.error(err?.message || 'Falha ao visualizar arquivo.');
    }
  };

  const handleDownloadZip = async (explicitIds) => {
    const ids =
      Array.isArray(explicitIds) && explicitIds.length > 0
        ? explicitIds
        : selectedNodeIds.length > 0
          ? selectedNodeIds
          : nodes.slice(0, 2).map((n) => n.id);
    if (ids.length === 0) return;
    try {
      const res = await microservicesApi.downloadStorageZip(ids);
      if (res?.blob) {
        triggerBrowserDownload(res.blob, 'nexus-vault-selecao.zip');
      }
      toast.success('Pacote ZIP gerado com sucesso.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao baixar pacote ZIP.');
    }
  };

  const handleToggleLock = async (node) => {
    try {
      if (node.lockedByEmail || node.locked_by_email) {
        await microservicesApi.unlockStorageNode(node.id);
        toast.success(`Check-in / desbloqueio realizado em "${node.name}".`);
      } else {
        await microservicesApi.lockStorageNode(node.id);
        toast.success(`Check-out / bloqueio ativado em "${node.name}".`);
      }
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha na operação de bloqueio.');
    }
  };

  const handleDeleteNodes = async (nodeList) => {
    const list = Array.isArray(nodeList) ? nodeList : [nodeList];
    const removedIds = [];
    for (const node of list) {
      if (!node?.id) continue;
      try {
        await microservicesApi.deleteStorageNode(node.id);
        removedIds.push(node.id);
      } catch (err) {
        toast.error(`Falha ao remover "${node.name}": ${err?.message || 'erro'}`);
      }
    }
    if (removedIds.length > 0) {
      setNodes((prev) => prev.filter((n) => !removedIds.includes(n.id)));
      setSelectedNodeIds((prev) => prev.filter((id) => !removedIds.includes(id)));
      toast.success(
        removedIds.length === 1
          ? `"${list[0].name}" movido para a lixeira da VPS.`
          : `${removedIds.length} itens movidos para a lixeira da VPS.`,
      );
    }
  };

  const handleOpenSheetFromExplorer = (node) => {
    if (!node?.id) return;
    setActiveSheetId(node.id);
    setActiveTab('sheets');
  };

  const handleCreateSheetInFolder = async (targetParentId) => {
    try {
      const stamped = `Planilha-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const res = await microservicesApi.createSheet({
        parentId: targetParentId || null,
        name: stamped,
        sheets: DEFAULT_SHEET_TABS,
      });
      const node = res?.node || res;
      if (node?.id) {
        setActiveSheetId(node.id);
        setNodes((prev) => [...prev, node]);
        wsHandleRef.current?.joinSheet?.(node.id);
        setActiveTab('sheets');
      }
      toast.success(`Planilha "${stamped}" criada e aberta no Nexus Sheets Live.`);
    } catch (err) {
      toast.error(err?.message || 'Falha ao criar planilha.');
    }
  };

  const handleLoadShareLinks = useCallback(async () => {
    const linksRes = await microservicesApi.listStorageShareLinks().catch(() => null);
    if (linksRes) {
      setShareLinks((prev) => {
        const prevTokens = new Map(prev.filter((l) => l.token || l.shareUrl).map((l) => [l.id, { token: l.token, shareUrl: l.shareUrl }]));
        return (linksRes.links || linksRes.items || []).map((item) => {
          const cached = prevTokens.get(item.id);
          return cached ? { ...item, ...cached } : item;
        });
      });
    }
  }, []);

  const handleCreateShareLinkForNode = async ({ nodeId, expiresInHours, allowDownload = true, password }) => {
    try {
      const hours = Math.max(1, Number(expiresInHours || 24));
      const res = await microservicesApi.createStorageShareLink({
        nodeId,
        expiresInHours: hours,
        expiresInMinutes: hours * 60,
        allowDownload: Boolean(allowDownload),
        password: password || undefined,
      });
      const rawToken = res?.token || res?.link?.token;
      const shareUrl = rawToken ? `${getGatewayBaseUrl()}/api/v1/storage/share/${rawToken}` : '';
      const created = { ...(res?.link || res), token: rawToken, shareUrl };
      setShareLinks((prev) => [created, ...prev.filter((l) => l.id !== created.id)]);
      toast.success('Link temporário seguro criado com sucesso.');
      return { ...created, url: shareUrl, shareUrl };
    } catch (err) {
      toast.error(err?.message || 'Falha ao criar link temporário.');
      return null;
    }
  };

  const handleRevokeShareLink = async (linkId, { purge = false } = {}) => {
    if (!linkId) return;
    try {
      await microservicesApi.revokeStorageShareLink(linkId, { purge });
      if (purge) {
        setShareLinks((prev) => prev.filter((l) => l.id !== linkId));
        toast.success('Link temporário excluído permanentemente.');
      } else {
        const nowIso = new Date().toISOString();
        setShareLinks((prev) =>
          prev.map((l) => (l.id === linkId ? { ...l, revokedAt: nowIso, revoked_at: nowIso, status: 'revoked' } : l)),
        );
        toast.success('Link temporário revogado e desativado.');
      }
    } catch (err) {
      toast.error(err?.message || 'Falha ao excluir link temporário.');
    }
  };

  const handleLoadVersions = async (node) => {
    setActiveNode(node);
    try {
      const res = await microservicesApi.listStorageVersions(node.id);
      setNodeVersions(res?.versions || res?.items || []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao listar versões.');
    }
  };

  const handleRestoreVersion = async (nodeId, versionNumber) => {
    try {
      await microservicesApi.restoreStorageVersion(nodeId, versionNumber);
      toast.success(`Versão v${versionNumber} restaurada com sucesso.`);
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao restaurar versão.');
    }
  };

  const handleLoadTrash = async () => {
    setShowTrash(true);
    try {
      const res = await microservicesApi.listStorageTrash();
      setTrashNodes(res?.items || res?.trash || []);
    } catch (err) {
      toast.error(err?.message || 'Falha ao carregar lixeira.');
    }
  };

  const handleRestoreTrashNode = async (nodeId) => {
    try {
      await microservicesApi.restoreStorageTrash(nodeId);
      setTrashNodes((prev) => prev.filter((t) => t.id !== nodeId));
      toast.success('Item restaurado da lixeira.');
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao restaurar item.');
    }
  };

  const handlePurgeTrashNode = async (nodeId) => {
    try {
      await microservicesApi.purgeStorageTrash(nodeId);
      setTrashNodes((prev) => prev.filter((t) => t.id !== nodeId));
      toast.success('Item expurgado permanentemente e cota liberada.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao expurgar item.');
    }
  };

  // Desktop Auto-Sync (`nexusvault://` via Agente Windows)
  const stopDesktopSyncTimers = useCallback(() => {
    if (desktopPollRef.current) {
      clearInterval(desktopPollRef.current);
      desktopPollRef.current = null;
    }
    if (desktopHintRef.current) {
      clearTimeout(desktopHintRef.current);
      desktopHintRef.current = null;
    }
  }, []);

  useEffect(() => () => stopDesktopSyncTimers(), [stopDesktopSyncTimers]);

  const launchDesktopProtocolUrl = (protocolUrl) => {
    if (typeof document === 'undefined' || !protocolUrl) return;
    const link = document.createElement('a');
    link.href = protocolUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 300);
  };

  const handleEditOnDesktop = async (node) => {
    if (!node || (node.nodeType || node.node_type || node.type) === 'folder') return;
    stopDesktopSyncTimers();
    setDesktopSyncBusy(true);
    setDesktopSlowHint(false);
    try {
      const created = await microservicesApi.createStorageDesktopSession(node.id);
      const apiBase = String(getGatewayBaseUrl() || '').replace(/\/$/, '');
      const protocolUrl = `nexusvault://edit?api=${encodeURIComponent(apiBase)}&token=${encodeURIComponent(created.sessionToken)}`;
      const initial = {
        sessionId: created.sessionId,
        sessionToken: created.sessionToken,
        nodeId: node.id,
        fileName: created.fileName || node.name,
        currentVersion: Number(created.currentVersion || node.currentVersion || 1),
        status: 'pending',
        syncCount: 0,
        lastSyncedAt: null,
        protocolUrl,
      };
      setDesktopSyncSession(initial);
      launchDesktopProtocolUrl(protocolUrl);
      await loadVaultOverview();

      desktopHintRef.current = setTimeout(() => {
        setDesktopSyncSession((cur) => {
          if (cur && cur.sessionToken === created.sessionToken && cur.status === 'pending') {
            setDesktopSlowHint(true);
          }
          return cur;
        });
      }, 6500);

      let prevSyncs = 0;
      desktopPollRef.current = setInterval(async () => {
        try {
          const st = await microservicesApi.getStorageDesktopSessionStatus(created.sessionToken);
          const nextSyncs = Number(st.syncCount ?? prevSyncs);
          if (st.status === 'opened') setDesktopSlowHint(false);
          if (nextSyncs > prevSyncs) {
            prevSyncs = nextSyncs;
            toast.success(`"${initial.fileName}" salvo automaticamente na VPS (v${st.currentVersion || st.lastVersion}).`);
            loadVaultOverview();
          }
          setDesktopSyncSession((cur) =>
            cur && cur.sessionToken === created.sessionToken
              ? {
                  ...cur,
                  status: st.status || cur.status,
                  syncCount: nextSyncs,
                  currentVersion: Number(st.currentVersion ?? st.lastVersion ?? cur.currentVersion),
                  lastSyncedAt: st.lastSyncedAt || cur.lastSyncedAt,
                }
              : cur,
          );
          if (st.status === 'closed' || st.status === 'expired') {
            stopDesktopSyncTimers();
            loadVaultOverview();
          }
        } catch {
          /* continue polling */
        }
      }, 2500);
    } catch (err) {
      toast.error(err?.message || 'Não foi possível abrir o arquivo no computador.');
    } finally {
      setDesktopSyncBusy(false);
    }
  };

  const handleCloseDesktopSession = async () => {
    if (!desktopSyncSession?.sessionToken) {
      stopDesktopSyncTimers();
      setDesktopSyncSession(null);
      return;
    }
    setDesktopSyncBusy(true);
    try {
      await microservicesApi.closeStorageDesktopSession(desktopSyncSession.sessionToken);
      stopDesktopSyncTimers();
      toast.success(`Sessão de "${desktopSyncSession.fileName}" encerrada e arquivo desbloqueado.`);
      setDesktopSyncSession(null);
      setDesktopSlowHint(false);
      await loadVaultOverview();
    } catch (err) {
      toast.error(err?.message || 'Falha ao encerrar sessão desktop.');
    } finally {
      setDesktopSyncBusy(false);
    }
  };

  // Handlers Tab 3: ACL & Audit
  const handleLoadAclAndAudit = useCallback(async () => {
    if (aclNodeId && canManageAcl) {
      const aclRes = await microservicesApi.getStorageNodeAcl(aclNodeId).catch(() => null);
      if (aclRes) {
        setAclRules(aclRes.rules || aclRes.acls || aclRes.items || []);
      }
    }
    const [linksRes, auditRes, verifyRes] = await Promise.all([
      microservicesApi.listStorageShareLinks().catch(() => null),
      microservicesApi.listAuditChain().catch(() => null),
      microservicesApi.verifyAuditChain().catch(() => null),
    ]);
    if (linksRes) setShareLinks(linksRes.links || linksRes.items || []);
    if (auditRes) setAuditEntries(auditRes.items || auditRes.entries || []);
    if (verifyRes) setChainStatus(verifyRes);
  }, [aclNodeId, canManageAcl]);

  useEffect(() => {
    if (activeTab === 'acl') {
      handleLoadAclAndAudit();
    }
  }, [activeTab, handleLoadAclAndAudit]);

  const handleSaveAclRule = async (e) => {
    e?.preventDefault?.();
    if (!canManageAcl) {
      toast.error('Permissão insuficiente: requer cloud:acl.');
      return;
    }
    const targetNodeId = aclNodeId || nodes[0]?.id;
    if (!targetNodeId) return;
    try {
      const res = await microservicesApi.saveStorageNodeAcl(targetNodeId, {
        rules: [aclForm],
      });
      setAclRules(res?.rules || res?.acls || [aclForm]);
      toast.success('Regra ACL granular aplicada com sucesso.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao salvar regra ACL.');
    }
  };

  const handleDeleteAclRule = async (ruleId) => {
    const targetNodeId = aclNodeId || nodes[0]?.id;
    if (!targetNodeId) return;
    try {
      await microservicesApi.deleteStorageNodeAcl(targetNodeId, ruleId);
      setAclRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success('Regra ACL removida.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao remover regra ACL.');
    }
  };

  const handleCreateShareLink = async (e) => {
    e?.preventDefault?.();
    const targetNodeId = aclNodeId || nodes[0]?.id;
    if (!targetNodeId) return;
    const created = await handleCreateShareLinkForNode({
      nodeId: targetNodeId,
      expiresInHours: Number(shareLinkForm.expiresInHours || 24),
      allowDownload: Boolean(shareLinkForm.allowDownload),
      password: shareLinkForm.password.trim() || undefined,
    });
    if (created) {
      setShareLinkForm((prev) => ({ ...prev, password: '' }));
    }
  };

  // Handlers Tab 4: Nexus Sheets Live
  const handleLoadSheet = useCallback(
    async (sheetIdToLoad) => {
      const targetId = sheetIdToLoad || activeSheetId;
      if (!targetId) return;
      try {
        const res = await microservicesApi.getSheet(targetId);
        const tabs = res?.sheets || res?.tabs || res?.workbook?.sheets || DEFAULT_SHEET_TABS;
        setSheetTabs(evaluateSheetFormulas(tabs));
        if (res?.rev) setSheetRev(Number(res.rev));
        wsHandleRef.current?.joinSheet?.(targetId);
        const histRes = await microservicesApi.getSheetHistory(targetId).catch(() => null);
        if (histRes) {
          setCellHistory(histRes.history || histRes.items || []);
        }
      } catch (err) {
        toast.error(err?.message || 'Falha ao carregar planilha.');
      }
    },
    [activeSheetId],
  );

  useEffect(() => {
    if (activeTab === 'sheets' && activeSheetId) {
      handleLoadSheet(activeSheetId);
    }
  }, [activeTab, activeSheetId, handleLoadSheet]);

  const handleCreateNewSheet = async (e) => {
    e?.preventDefault?.();
    try {
      const res = await microservicesApi.createSheet({
        parentId: currentFolderId,
        name: newSheetName || 'Planilha-Corporativa.xlsx',
        sheets: DEFAULT_SHEET_TABS,
      });
      const node = res?.node || res;
      if (node?.id) {
        setActiveSheetId(node.id);
        setNodes((prev) => [...prev, node]);
        wsHandleRef.current?.joinSheet?.(node.id);
      }
      if (res?.sheets || res?.tabs) {
        setSheetTabs(evaluateSheetFormulas(res.sheets || res.tabs));
      }
      toast.success('Planilha Nexus Sheets Live criada na VPS.');
    } catch (err) {
      toast.error(err?.message || 'Falha ao criar planilha.');
    }
  };

  const handleSelectCell = (cellRef) => {
    setSelectedCellRef(cellRef);
    const cell = currentSheetTab?.cells?.[cellRef] || {};
    setFormulaInput(cell.formula || (cell.value !== undefined && cell.value !== null ? String(cell.value) : ''));
    if (activeSheetId) {
      wsHandleRef.current?.sendSheetCursor?.({
        fileId: activeSheetId,
        tab: currentSheetTab.name,
        tabName: currentSheetTab.name,
        cell: cellRef,
        cellRef,
      });
    }
  };

  const handleApplyCellEdit = (cellRef, rawInput) => {
    const str = String(rawInput ?? '');
    const isFormula = str.trim().startsWith('=');
    setSheetTabs((prev) => {
      const next = prev.map((tab, idx) => {
        if (idx !== activeSheetTabIdx) return tab;
        const nextCells = { ...(tab.cells || {}) };
        nextCells[cellRef] = {
          ...(nextCells[cellRef] || {}),
          formula: isFormula ? str.trim() : null,
          value: isFormula ? evaluateCellValue(str.trim(), tab.cells || {}, prev) : str,
        };
        return { ...tab, cells: nextCells };
      });
      return evaluateSheetFormulas(next);
    });

    if (activeSheetId) {
      wsHandleRef.current?.sendSheetCellPatch?.({
        fileId: activeSheetId,
        tab: currentSheetTab.name,
        tabName: currentSheetTab.name,
        cell: cellRef,
        cellRef,
        value: isFormula ? undefined : str,
        formula: isFormula ? str.trim() : null,
        baseRev: sheetRev,
      });
    }
  };

  const handleSaveSheetNow = async () => {
    const targetId = activeSheetId || 'sheet-default';
    try {
      const res = await microservicesApi.saveSheet(targetId, {
        expectedRev: sheetRev,
        sheets: EvaluatedTabs,
        tabs: EvaluatedTabs,
      });
      if (res?.rev) setSheetRev(Number(res.rev));
      toast.success(`Planilha salva na VPS (rev ${res?.rev || sheetRev + 1}).`);
    } catch (err) {
      toast.error(err?.message || 'Conflito ou falha ao salvar planilha.');
    }
  };

  const handleExportSheet = async (format) => {
    const targetId = activeSheetId || 'sheet-default';
    try {
      const res = await microservicesApi.exportSheet(targetId, format);
      if (res?.blob) {
        triggerBrowserDownload(res.blob, `planilha-nexus.${format}`);
      }
      toast.success(`Planilha exportada em formato .${format}.`);
    } catch (err) {
      toast.error(err?.message || 'Falha ao exportar planilha.');
    }
  };

  const handleAddSheetTab = () => {
    const title = newTabTitle.trim() || `Planilha${sheetTabs.length + 1}`;
    const newTab = {
      name: title,
      freezeRow: 1,
      columns: ['A', 'B', 'C', 'D', 'E', 'F'],
      cells: {},
    };
    setSheetTabs((prev) => [...prev, newTab]);
    setActiveSheetTabIdx(sheetTabs.length);
    setNewTabTitle('');
    if (activeSheetId) {
      wsHandleRef.current?.sendSheetTabAdd?.({
        fileId: activeSheetId,
        tabName: title,
      });
    }
  };

  if (zeroKnowledgeBlocked) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-center space-y-3">
        <Shield className="mx-auto text-rose-500" size={36} />
        <h1 className="text-xl font-black text-slate-900 dark:text-white">
          Bloqueio Zero-Knowledge LGPD (ZERO_KNOWLEDGE_RESTRICTED)
        </h1>
        <p className="text-sm text-slate-600 dark:text-zinc-300">
          O perfil Superadmin (Nexus Master) atua apenas como operador de infraestrutura e não possui acesso às credenciais de VPS, chaves SSH/S3 ou arquivos privados das empresas clientes.
        </p>
      </div>
    );
  }

  if (!planEntitled) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-center space-y-3">
        <Lock className="mx-auto text-amber-500" size={36} />
        <h1 className="text-xl font-black text-slate-900 dark:text-white">
          Módulo Cloud Vault &amp; Conector VPS Indisponível no Plano Atual (FEATURE_NOT_IN_PLAN)
        </h1>
        <p className="text-sm text-slate-600 dark:text-zinc-300">
          Faça upgrade para o Plano Pro, Enterprise ou adicione o módulo Cloud Vault no seu contrato sob medida.
        </p>
      </div>
    );
  }

  const quotaAlertBanner =
    quotaInfo.alertLevel === 'critical_90' || quotaInfo.usagePercent >= 90 ? (
      <div
        role="alert"
        data-testid="quota-alert-critical"
        className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2"
      >
        <AlertTriangle size={16} />
        <span>
          Alerta Crítico (90%+): O espaço reservado na VPS atingiu {quotaInfo.usagePercent}% ({formatBytes(quotaInfo.usedBytes)} / {formatBytes(quotaInfo.quotaBytes)}).
        </span>
      </div>
    ) : quotaInfo.alertLevel === 'warning_80' || quotaInfo.usagePercent >= 80 ? (
      <div
        role="alert"
        data-testid="quota-alert-warning"
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2"
      >
        <AlertTriangle size={16} />
        <span>
          Alerta de Cota (80%+): O espaço reservado na VPS atingiu {quotaInfo.usagePercent}% ({formatBytes(quotaInfo.usedBytes)} / {formatBytes(quotaInfo.quotaBytes)}).
        </span>
      </div>
    ) : null;

  return (
    <div className="max-w-7xl mx-auto pb-20 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-aa">
            <HardDrive size={15} />
            <span>API 6 • Armazenamento Corporativo Multitenant</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            Nexus Cloud Vault &amp; Conector VPS
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400">
            Vínculo híbrido SFTP/SSH, Agente 1-Click Linux e S3/MinIO com controle granular em 5 níveis e coedição em tempo real.
          </p>
        </div>

        {/* Quota Meter Summary */}
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-3.5 min-w-[280px]">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-zinc-200 mb-1.5">
            <span>Espaço Reservado na VPS</span>
            <span className="font-mono tabular-nums">
              {formatBytes(quotaInfo.usedBytes)} / {formatBytes(quotaInfo.quotaBytes)} ({quotaInfo.usagePercent}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                quotaInfo.usagePercent >= 90
                  ? 'bg-rose-500'
                  : quotaInfo.usagePercent >= 80
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, quotaInfo.usagePercent)}%` }}
            />
          </div>
        </div>
      </div>

      {quotaAlertBanner}

      {/* 4 Navigation Tabs */}
      <div aria-label="Abas do Cloud Vault" className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-zinc-800 pb-3">
        {[
          { id: 'connection', label: 'Conexão & Telemetria VPS', icon: Server },
          { id: 'explorer', label: 'Explorer VFS (Pastas & Arquivos)', icon: Folder },
          { id: 'acl', label: 'Matriz ACL & Auditoria SHA-256', icon: ShieldCheck },
          { id: 'sheets', label: 'Nexus Sheets Live', icon: FileSpreadsheet },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              data-testid={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                active
                  ? 'bg-brand text-brand-fg shadow-sm'
                  : 'bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 hover:border-brand/40'
              }`}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CONEXÃO & TELEMETRIA VPS */}
      {activeTab === 'connection' && (
        <div className="space-y-6">
          <VpsOnboardingTutorial
            providerType={connForm.providerType}
            isConfigured={Boolean(connStatus && connStatus.configured !== false && (connStatus.id || connStatus.endpointUrl || connStatus.host))}
            isConnected={(healthInfo?.status || connStatus?.status) === 'connected'}
            hasFolders={nodes.length > 0}
            onSelectProvider={(drv) => setConnForm((p) => ({ ...p, providerType: drv }))}
            onOpenExplorerTab={() => setActiveTab('explorer')}
            onOpenAclTab={() => setActiveTab('acl')}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Server size={18} className="text-brand-aa" />
                <span>Configuração do Conector Híbrido VPS</span>
              </h2>
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold">
                AES-256-GCM Vault
              </span>
            </div>

            {!canConnect && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                Somente Proprietário ou Administrador (`cloud:connect`) podem alterar credenciais da VPS.
              </div>
            )}

            <form onSubmit={handleSaveConnection} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="vps-provider-type" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Provedor / Driver VPS
                  </label>
                  <select
                    id="vps-provider-type"
                    aria-label="Provedor Driver VPS"
                    disabled={!canConnect}
                    value={connForm.providerType}
                    onChange={(e) => setConnForm((p) => ({ ...p, providerType: e.target.value }))}
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="sftp">SFTP / SSH Nativo (Zero-Install)</option>
                    <option value="agent_node">Nexus Storage Node (Agente 1-Click Linux)</option>
                    <option value="s3">S3 / MinIO / Cloudflare R2</option>
                    <option value="webdav">WebDAV / Nextcloud</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="vps-root-path" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Diretório Raiz Reservado (Chroot Jail)
                  </label>
                  <input
                    id="vps-root-path"
                    type="text"
                    disabled={!canConnect}
                    value={connForm.rootPath}
                    onChange={(e) => setConnForm((p) => ({ ...p, rootPath: e.target.value }))}
                    placeholder="/srv/nexus-vault"
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label htmlFor="vps-quota-gb" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Capacidade Reservada (GB)
                  </label>
                  <input
                    id="vps-quota-gb"
                    type="number"
                    min={1}
                    max={102400}
                    disabled={!canConnect}
                    value={Math.max(1, Math.round(Number(connForm.quotaBytes || 53687091200) / (1024 * 1024 * 1024)))}
                    onChange={(e) => {
                      const gb = Math.max(1, Number(e.target.value || 1));
                      setConnForm((p) => ({ ...p, quotaBytes: gb * 1024 * 1024 * 1024 }));
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {connForm.providerType === 'sftp' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="vps-host" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Host / IP da VPS
                    </label>
                    <input
                      id="vps-host"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.host}
                      onChange={(e) => setConnForm((p) => ({ ...p, host: e.target.value }))}
                      placeholder="vps.empresa.com.br"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="vps-port" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Porta SSH
                    </label>
                    <input
                      id="vps-port"
                      type="number"
                      disabled={!canConnect}
                      value={connForm.port}
                      onChange={(e) => setConnForm((p) => ({ ...p, port: e.target.value }))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="vps-user" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Usuário SSH
                    </label>
                    <input
                      id="vps-user"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.username}
                      onChange={(e) => setConnForm((p) => ({ ...p, username: e.target.value }))}
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="vps-pass" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                        Senha SSH (opcional se usar Chave)
                      </label>
                      <input
                        id="vps-pass"
                        type="password"
                        disabled={!canConnect}
                        value={connForm.password}
                        onChange={(e) => setConnForm((p) => ({ ...p, password: e.target.value }))}
                        placeholder="••••••••"
                        className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="vps-private-key" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                        Chave Privada OpenSSH / PEM (opcional)
                      </label>
                      <textarea
                        id="vps-private-key"
                        rows={2}
                        disabled={!canConnect}
                        value={connForm.privateKey}
                        onChange={(e) => setConnForm((p) => ({ ...p, privateKey: e.target.value }))}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                        className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {connForm.providerType === 'agent_node' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="vps-endpoint" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Endpoint do Nexus Storage Node
                    </label>
                    <input
                      id="vps-endpoint"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.endpointUrl}
                      onChange={(e) => setConnForm((p) => ({ ...p, endpointUrl: e.target.value }))}
                      placeholder="http://IP-DA-VPS:9443"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="vps-hmac" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Token HMAC-SHA256 (preenchido pelo Script)
                    </label>
                    <input
                      id="vps-hmac"
                      type="password"
                      disabled={!canConnect}
                      value={connForm.hmacToken}
                      onChange={(e) => setConnForm((p) => ({ ...p, hmacToken: e.target.value }))}
                      placeholder="Preservado automaticamente ao gerar script"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              )}

              {connForm.providerType === 's3' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="s3-endpoint" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Endpoint S3 / MinIO / R2
                    </label>
                    <input
                      id="s3-endpoint"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.endpointUrl}
                      onChange={(e) => setConnForm((p) => ({ ...p, endpointUrl: e.target.value }))}
                      placeholder="https://minio.empresa.com.br"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="s3-bucket" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Bucket
                    </label>
                    <input
                      id="s3-bucket"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.bucket}
                      onChange={(e) => setConnForm((p) => ({ ...p, bucket: e.target.value }))}
                      placeholder="nexus-vault"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="s3-access-key" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Access Key ID
                    </label>
                    <input
                      id="s3-access-key"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.accessKey}
                      onChange={(e) => setConnForm((p) => ({ ...p, accessKey: e.target.value }))}
                      placeholder="AKIA..."
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="s3-secret-key" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Secret Access Key
                    </label>
                    <input
                      id="s3-secret-key"
                      type="password"
                      disabled={!canConnect}
                      value={connForm.secretKey}
                      onChange={(e) => setConnForm((p) => ({ ...p, secretKey: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              )}

              {connForm.providerType === 'webdav' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="s3-endpoint" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Endpoint WebDAV / Nextcloud
                    </label>
                    <input
                      id="s3-endpoint"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.endpointUrl}
                      onChange={(e) => setConnForm((p) => ({ ...p, endpointUrl: e.target.value }))}
                      placeholder="https://nuvem.empresa.com.br/remote.php/dav/files/usuario"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="webdav-user" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Usuário WebDAV
                    </label>
                    <input
                      id="webdav-user"
                      type="text"
                      disabled={!canConnect}
                      value={connForm.username}
                      onChange={(e) => setConnForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder="usuario"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="webdav-pass" className="block text-xs font-bold text-slate-700 dark:text-zinc-300 mb-1">
                      Senha de Aplicativo
                    </label>
                    <input
                      id="webdav-pass"
                      type="password"
                      disabled={!canConnect}
                      value={connForm.password}
                      onChange={(e) => setConnForm((p) => ({ ...p, password: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={!canConnect}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-brand text-brand-fg text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Save size={14} />
                  <span>Salvar Credenciais VPS</span>
                </button>
                <button
                  type="button"
                  disabled={!canConnect}
                  onClick={handleTestConnection}
                  aria-label="Testar Conexão VPS"
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Activity size={14} />
                  <span>Diagnosticar Nó VPS</span>
                </button>
                <button
                  type="button"
                  disabled={!canConnect}
                  onClick={handleInitializeVault}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <FolderPlus size={14} />
                  <span>Inicializar Estrutura</span>
                </button>
                <button
                  type="button"
                  disabled={!canConnect}
                  onClick={() => handleGenerateInstallScript(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Terminal size={14} />
                  <span>Gerar Script 1-Click Linux</span>
                </button>
              </div>
            </form>

            {installScriptData && (
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-900 text-emerald-300 p-4 text-xs font-mono space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-300">
                  <span>Script 1-Click (Node + systemd + HMAC) • Token: {installScriptData.tokenPrefix}</span>
                  <div className="flex items-center gap-2 font-sans">
                    <button
                      type="button"
                      onClick={handleCopyInstallScript}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-600/30 font-semibold flex items-center gap-1"
                    >
                      <Copy size={12} />
                      <span>Copiar Script</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerateInstallScript(true)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-200 hover:bg-amber-500/25 font-semibold flex items-center gap-1"
                    >
                      <RefreshCw size={12} />
                      <span>Rotacionar Token</span>
                    </button>
                  </div>
                </div>
                <p className="font-sans text-[11px] text-zinc-400">
                  1) Execute na VPS como root. 2) Preencha o Endpoint exibido no terminal (ex: http://IP-DA-VPS:9443), clique em Salvar Credenciais VPS e Diagnosticar Nó VPS.
                </p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap select-all">{installScriptData.script || installScriptData.installCommand}</pre>
              </div>
            )}
          </div>

          {/* Telemetry & Department Quota Breakdown */}
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Activity size={16} className="text-emerald-500" />
              <span>Saúde do Nó &amp; Cotas por Setor</span>
            </h3>

            <div className="rounded-xl bg-slate-50 dark:bg-zinc-900 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Status do Nó:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {healthInfo?.status || connStatus?.status || 'connected'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Latência:</span>
                <span className="font-mono font-bold">{healthInfo?.latencyMs ?? connStatus?.latencyMs ?? 12} ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Driver Ativo:</span>
                <span className="font-mono uppercase">{connForm.providerType}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase text-slate-500">Consumo por Departamento</h4>
              {quotaInfo.byDepartment.length === 0 ? (
                <p className="text-xs text-slate-500">Sem consumo setorial registrado.</p>
              ) : (
                quotaInfo.byDepartment.map((d) => (
                  <div key={d.department} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-zinc-800">
                    <span className="font-semibold text-slate-700 dark:text-zinc-200">{d.department}</span>
                    <span className="font-mono">{formatBytes(d.usedBytes)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* TAB 2: EXPLORER VFS (WINDOWS FILE EXPLORER UX) */}
      {activeTab === 'explorer' && (
        <WindowsFileExplorer
          nodes={nodes}
          trashNodes={trashNodes}
          quotaInfo={quotaInfo}
          canWrite={canWrite}
          canManageAcl={canManageAcl}
          currentFolderId={currentFolderId}
          onChangeFolder={setCurrentFolderId}
          showTrash={showTrash}
          onOpenTrash={handleLoadTrash}
          onCloseTrash={() => setShowTrash(false)}
          searchQuery={searchQuery}
          onChangeSearch={setSearchQuery}
          selectedNodeIds={selectedNodeIds}
          onChangeSelectedIds={setSelectedNodeIds}
          activeNode={activeNode}
          nodeVersions={nodeVersions}
          previewInfo={previewInfo}
          onClosePreview={closePreviewInfo}
          onRefresh={loadVaultOverview}
          onCreateFolder={handleCreateFolder}
          onUploadFiles={handleUploadFiles}
          onRenameNode={handleRenameNode}
          onMoveNode={handleMoveNode}
          onCopyNode={handleCopyNode}
          onPreviewNode={handlePreviewNode}
          onDownloadNode={handleDownloadNode}
          onDownloadZip={handleDownloadZip}
          onToggleLock={handleToggleLock}
          onDeleteNodes={handleDeleteNodes}
          onLoadVersions={handleLoadVersions}
          onRestoreVersion={handleRestoreVersion}
          onRestoreTrashNode={handleRestoreTrashNode}
          onPurgeTrashNode={handlePurgeTrashNode}
          onOpenSheet={handleOpenSheetFromExplorer}
          onCreateSheet={handleCreateSheetInFolder}
          shareLinks={shareLinks}
          onLoadShareLinks={handleLoadShareLinks}
          onCreateShareLink={handleCreateShareLinkForNode}
          onRevokeShareLink={handleRevokeShareLink}
          onEditOnDesktop={handleEditOnDesktop}
          onOpenDesktopGuide={() => setShowDesktopGuide(true)}
          uploadingCount={uploadingCount}
        />
      )}

      {/* TAB 3: MATRIZ ACL & AUDITORIA SHA-256 */}
      {activeTab === 'acl' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck size={18} className="text-brand-aa" />
              <span>Matriz ACL em 5 Níveis &amp; Links Temporários</span>
            </h2>

            <div>
              <label htmlFor="acl-node-select" className="block text-xs font-bold mb-1">
                Pasta ou Arquivo Alvo
              </label>
              <select
                id="acl-node-select"
                value={aclNodeId}
                onChange={(e) => setAclNodeId(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.virtualPath || n.virtual_path || n.name}
                  </option>
                ))}
              </select>
            </div>

            {canManageAcl && (
              <form onSubmit={handleSaveAclRule} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  aria-label="Tipo de Alvo ACL"
                  value={aclForm.targetType}
                  onChange={(e) => setAclForm((p) => ({ ...p, targetType: e.target.value }))}
                  className="min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 text-xs"
                >
                  <option value="department">Departamento</option>
                  <option value="role">Papel (Role)</option>
                  <option value="user">Usuário (E-mail)</option>
                </select>
                <input
                  type="text"
                  aria-label="Valor do Alvo ACL"
                  value={aclForm.targetValue}
                  onChange={(e) => setAclForm((p) => ({ ...p, targetValue: e.target.value }))}
                  placeholder="Ex: Financeiro ou email@empresa.com"
                  className="min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 text-xs"
                />
                <select
                  aria-label="Nível de Acesso ACL"
                  value={aclForm.accessLevel}
                  onChange={(e) => setAclForm((p) => ({ ...p, accessLevel: e.target.value }))}
                  className="min-h-[40px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 text-xs"
                >
                  {Object.entries(ACL_LEVEL_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="sm:col-span-3 min-h-[40px] rounded-xl bg-brand text-brand-fg text-xs font-bold"
                >
                  Aplicar Regra ACL
                </button>
              </form>
            )}

            <div className="space-y-1.5">
              {aclRules.map((r, idx) => (
                <div
                  key={r.id || idx}
                  className="flex items-center justify-between text-xs py-2 px-3 rounded-xl bg-slate-50 dark:bg-zinc-900"
                >
                  <span>
                    <strong>{r.targetType || r.target_type}:</strong> {r.targetValue || r.target_value} →{' '}
                    <span className="font-mono font-bold text-brand-aa">{r.accessLevel || r.access_level}</span>
                  </span>
                  {canManageAcl && r.id && (
                    <button
                      type="button"
                      onClick={() => handleDeleteAclRule(r.id)}
                      className="text-rose-500 font-bold"
                    >
                      Remover
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Share link generator & manager */}
            <div className="pt-3 border-t border-slate-200 dark:border-zinc-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
                  <Link2 size={14} />
                  <span>Emitir &amp; Gerenciar Links Temporários</span>
                </h3>
                {shareLinks.some((l) => l.revokedAt || l.revoked_at || l.status === 'revoked' || l.status === 'expired') && (
                  <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showInactiveLinks}
                      onChange={(e) => setShowInactiveLinks(e.target.checked)}
                    />
                    <span>Mostrar revogados/expirados</span>
                  </label>
                )}
              </div>

              <form onSubmit={handleCreateShareLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="number"
                  min={1}
                  aria-label="Validade em horas"
                  placeholder="Validade (h)"
                  value={shareLinkForm.expiresInHours}
                  onChange={(e) => setShareLinkForm((p) => ({ ...p, expiresInHours: e.target.value }))}
                  className="min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 text-xs"
                />
                <input
                  type="password"
                  aria-label="Senha opcional do link"
                  placeholder="Senha (opcional)"
                  value={shareLinkForm.password}
                  onChange={(e) => setShareLinkForm((p) => ({ ...p, password: e.target.value }))}
                  className="min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-2.5 text-xs"
                />
                <label className="min-h-[38px] px-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-xs flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(shareLinkForm.allowDownload)}
                    onChange={(e) => setShareLinkForm((p) => ({ ...p, allowDownload: e.target.checked }))}
                  />
                  <span>Permitir download</span>
                </label>
                <button
                  type="submit"
                  className="sm:col-span-3 min-h-[38px] px-3 py-1.5 rounded-xl border border-brand/40 bg-brand/10 text-brand-aa text-xs font-bold"
                >
                  Gerar Link Temporário
                </button>
              </form>

              {(() => {
                const nowMs = Date.now();
                const normalizedLinks = shareLinks.map((lnk) => {
                  const isRevoked = Boolean(lnk.revokedAt || lnk.revoked_at || lnk.status === 'revoked');
                  const expMs = new Date(lnk.expiresAt || lnk.expires_at || 0).getTime();
                  const isExpired = !isRevoked && expMs > 0 && expMs <= nowMs;
                  const targetNode = nodes.find((n) => n.id === (lnk.nodeId || lnk.node_id));
                  const fullUrl =
                    lnk.shareUrl ||
                    (lnk.token ? `${getGatewayBaseUrl()}/api/v1/storage/share/${lnk.token}` : null);
                  return {
                    ...lnk,
                    isRevoked,
                    isExpired,
                    isActive: !isRevoked && !isExpired,
                    displayName: lnk.nodeName || targetNode?.name || 'Arquivo compartilhado',
                    fullUrl,
                  };
                });
                const displayedLinks = showInactiveLinks
                  ? normalizedLinks
                  : normalizedLinks.filter((l) => l.isActive);

                if (displayedLinks.length === 0) {
                  return (
                    <p className="text-xs text-slate-500 py-1">
                      Nenhum link temporário ativo no momento.
                    </p>
                  );
                }

                return (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {displayedLinks.map((lnk) => (
                      <div
                        key={lnk.id || lnk.token}
                        data-testid={`share-link-${lnk.id || lnk.token}`}
                        className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-2.5 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-slate-900 dark:text-white truncate">
                              {lnk.displayName}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                lnk.isRevoked
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : lnk.isExpired
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {lnk.isRevoked ? 'Revogado' : lnk.isExpired ? 'Expirado' : 'Ativo'}
                            </span>
                            {lnk.hasPassword && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-800">
                                Com senha
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {lnk.fullUrl && lnk.isActive && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator?.clipboard?.writeText?.(lnk.fullUrl);
                                  toast.success('Link copiado para a área de transferência.');
                                }}
                                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px] font-bold flex items-center gap-1"
                              >
                                <Copy size={11} />
                                <span>Copiar</span>
                              </button>
                            )}
                            {lnk.id && lnk.isActive && (
                              <button
                                type="button"
                                aria-label={`Revogar link de ${lnk.displayName}`}
                                onClick={() => handleRevokeShareLink(lnk.id, { purge: false })}
                                className="px-2 py-1 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-bold flex items-center gap-1"
                              >
                                <Trash2 size={11} />
                                <span>Excluir Link</span>
                              </button>
                            )}
                            {lnk.id && !lnk.isActive && (
                              <button
                                type="button"
                                aria-label={`Remover registro do link de ${lnk.displayName}`}
                                onClick={() => handleRevokeShareLink(lnk.id, { purge: true })}
                                className="px-2 py-1 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-500 hover:text-rose-600 text-[11px] font-semibold flex items-center gap-1"
                              >
                                <Trash2 size={11} />
                                <span>Remover</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Acessos: {lnk.accessCount ?? lnk.access_count ?? 0}</span>
                          <span>{lnk.allowDownload || lnk.allow_download ? 'Download liberado' : 'Somente visualização'}</span>
                          {(lnk.expiresAt || lnk.expires_at) && (
                            <span>
                              Expira: {new Date(lnk.expiresAt || lnk.expires_at).toLocaleString('pt-BR')}
                            </span>
                          )}
                        </div>

                        {lnk.fullUrl && (
                          <div className="font-mono text-[11px] text-brand-aa break-all bg-white dark:bg-zinc-950 rounded-lg px-2 py-1 border border-slate-200 dark:border-zinc-800">
                            {lnk.fullUrl}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* SHA-256 Audit Chain */}
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Shield size={18} className="text-emerald-500" />
                <span>Trilha de Auditoria Imutável (SHA-256 Hash-Chain)</span>
              </h2>
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
                {chainStatus?.intact !== false ? 'Hash-Chain Íntegra' : 'Divergência'}
              </span>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {auditEntries.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum evento de auditoria carregado.</p>
              ) : (
                auditEntries.slice(0, 20).map((entry) => (
                  <div
                    key={entry.id || entry.seq}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>#{entry.seq} • {entry.action}</span>
                      <span className="font-mono text-slate-500">{entry.actor_email || entry.actorEmail}</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 truncate">
                      SHA-256: {entry.entry_hash || entry.entryHash}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: NEXUS SHEETS LIVE */}
      {activeTab === 'sheets' && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <FileSpreadsheet size={18} className="text-emerald-500" />
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                Nexus Sheets Live (Coedição WebSocket em Tempo Real)
              </h2>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
                rev #{sheetRev}
              </span>
              {sheetPeers.length > 0 && (
                <span data-testid="sheet-peers-badge" className="text-xs font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  {sheetPeers.length} online ({sheetPeers.map((p) => p.name || p.email || p.userEmail).join(', ')})
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleCreateNewSheet} className="flex items-center gap-1.5">
                <input
                  type="text"
                  aria-label="Nome da nova planilha"
                  value={newSheetName}
                  onChange={(e) => setNewSheetName(e.target.value)}
                  className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-xs"
                />
                <button
                  type="submit"
                  className="min-h-[36px] px-3 rounded-xl bg-brand text-brand-fg text-xs font-bold"
                >
                  Nova Planilha
                </button>
              </form>
              <button
                type="button"
                onClick={handleSaveSheetNow}
                className="min-h-[36px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"
              >
                <Save size={13} />
                <span>Salvar na VPS</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportSheet('xlsx')}
                className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold"
              >
                Exportar .XLSX
              </button>
              <button
                type="button"
                onClick={() => handleExportSheet('csv')}
                className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold"
              >
                Exportar .CSV
              </button>
            </div>
          </div>

          {/* Formula Bar */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 p-2 rounded-xl border border-slate-200 dark:border-zinc-800">
            <span
              data-testid="active-cell-indicator"
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 font-mono text-xs font-black border border-slate-200 dark:border-zinc-700"
            >
              {selectedCellRef}
            </span>
            <span className="font-mono text-xs font-bold text-slate-400">fx</span>
            <input
              type="text"
              aria-label="Barra de Fórmulas"
              data-testid="sheet-formula-input"
              value={formulaInput}
              onChange={(e) => {
                setFormulaInput(e.target.value);
                handleApplyCellEdit(selectedCellRef, e.target.value);
              }}
              placeholder="Digite um valor ou fórmula (=SOMA(A1:A10), =MÉDIA(B1:B5), =SE(A1>100,&quot;Alto&quot;,&quot;OK&quot;))"
              className="flex-1 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-xs"
            />
          </div>

          {/* Grid Table */}
          <div className="overflow-x-auto border border-slate-200 dark:border-zinc-800 rounded-xl">
            <table className="w-full border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-slate-100 dark:bg-zinc-900">
                  <th className="w-10 border border-slate-200 dark:border-zinc-800 py-1.5 text-center">#</th>
                  {['A', 'B', 'C', 'D', 'E', 'F'].map((col) => (
                    <th key={col} className="min-w-[120px] border border-slate-200 dark:border-zinc-800 py-1.5 px-2 text-center font-bold">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((rowNum) => (
                  <tr key={rowNum}>
                    <td className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center font-bold text-slate-500">
                      {rowNum}
                    </td>
                    {['A', 'B', 'C', 'D', 'E', 'F'].map((col) => {
                      const ref = `${col}${rowNum}`;
                      const evalCell = evaluatedCurrentTab?.cells?.[ref] || {};
                      const rawCell = currentSheetTab?.cells?.[ref] || {};
                      const isSelected = selectedCellRef === ref;
                      const peerCursor = Object.values(sheetCursors).find(
                        (c) => c.cellRef === ref && c.tabName === currentSheetTab.name,
                      );
                      return (
                        <td
                          key={ref}
                          data-testid={`sheet-cell-${ref}`}
                          onClick={() => handleSelectCell(ref)}
                          className={`border border-slate-200 dark:border-zinc-800 p-0 relative ${
                            isSelected ? 'ring-2 ring-brand z-10' : ''
                          }`}
                        >
                          <input
                            type="text"
                            aria-label={`Célula ${ref}`}
                            value={
                              isSelected
                                ? formulaInput
                                : evalCell.value !== undefined && evalCell.value !== null
                                  ? String(evalCell.value)
                                  : ''
                            }
                            onFocus={() => handleSelectCell(ref)}
                            onChange={(e) => {
                              setFormulaInput(e.target.value);
                              handleApplyCellEdit(ref, e.target.value);
                            }}
                            className="w-full h-8 px-2 bg-transparent focus:outline-none text-xs font-mono"
                          />
                          {rawCell.formula && !isSelected && (
                            <span className="absolute top-0.5 right-1 text-[9px] text-emerald-600 font-bold">fx</span>
                          )}
                          {peerCursor && (
                            <span
                              data-testid={`remote-cursor-${ref}`}
                              className="absolute -top-2 right-0 px-1 rounded bg-sky-600 text-white text-[9px] font-sans font-bold"
                            >
                              {peerCursor.userName || peerCursor.userEmail}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sheet Tabs Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {sheetTabs.map((tab, idx) => (
                <button
                  key={tab.name}
                  type="button"
                  onClick={() => setActiveSheetTabIdx(idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    idx === activeSheetTabIdx
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-2">
                <input
                  type="text"
                  aria-label="Nome da nova aba"
                  placeholder="Nova aba..."
                  value={newTabTitle}
                  onChange={(e) => setNewTabTitle(e.target.value)}
                  className="w-28 px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs"
                />
                <button
                  type="button"
                  onClick={handleAddSheetTab}
                  className="px-2.5 py-1 rounded-lg bg-brand/15 text-brand-aa text-xs font-bold"
                >
                  + Aba
                </button>
              </div>
            </div>

            {cellHistory.length > 0 && (
              <div className="text-xs text-slate-500 font-mono">
                Última edição: {cellHistory[cellHistory.length - 1]?.cellRef} por{' '}
                {cellHistory[cellHistory.length - 1]?.actorEmail}
              </div>
            )}
          </div>
        </div>
      )}

      <DesktopSyncStatusModal
        session={desktopSyncSession}
        busy={desktopSyncBusy}
        slowHint={desktopSlowHint}
        onRelaunch={() => launchDesktopProtocolUrl(desktopSyncSession?.protocolUrl)}
        onOpenGuide={() => setShowDesktopGuide(true)}
        onCloseSession={handleCloseDesktopSession}
        onDismiss={() => {
          stopDesktopSyncTimers();
          setDesktopSyncSession(null);
          setDesktopSlowHint(false);
        }}
      />

      <DesktopSyncGuideModal open={showDesktopGuide} onClose={() => setShowDesktopGuide(false)} />
    </div>
  );
};

export default CloudVaultHub;
