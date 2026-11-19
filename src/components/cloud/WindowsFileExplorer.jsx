// src/components/cloud/WindowsFileExplorer.jsx
// =============================================================================
// Explorador de Arquivos Estilo Windows 11 Nativo — Nexus Cloud Vault
// =============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  List,
  Lock,
  MoreVertical,
  Music,
  PanelRight,
  Pencil,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  Unlock,
  UploadCloud,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

const QUICK_ACCESS_ALIASES = {
  '/Corporativo-Publico': 'Público da Empresa',
  '/Setores': 'Departamentos',
  '/Cofre-TI-Infra': 'Cofre TI & Termos',
  '/Chamados': 'Chamados TI',
  '/Espaco-Pessoal': 'Espaço Pessoal',
};

const ACCESS_LABELS_PT = {
  full_control: 'Controle Total',
  editor: 'Editor',
  reader: 'Leitor (Download)',
  viewer_online: 'Somente Leitura Online',
  none: 'Bloqueado',
};

function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isFolderNode(node) {
  return (node?.nodeType || node?.node_type || node?.type) === 'folder';
}

function getParentId(node) {
  return node?.parentId ?? node?.parent_id ?? null;
}

function getNodePath(node) {
  return node?.virtualPath || node?.virtual_path || `/${node?.name || ''}`;
}

function getLockedBy(node) {
  return node?.lockedByEmail || node?.locked_by_email || null;
}

function getFileKind(node) {
  if (isFolderNode(node)) {
    return {
      label: 'Pasta de arquivos',
      Icon: Folder,
      colorClass: 'text-amber-500',
      bgClass: 'bg-amber-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  const name = String(node?.name || '').toLowerCase();
  const mime = String(node?.mimeType || node?.mime_type || '').toLowerCase();

  if (/\.(xlsx|xls|csv|nexusheet)$/i.test(name) || mime.includes('spreadsheet') || mime.includes('csv')) {
    return {
      label: 'Planilha',
      Icon: FileSpreadsheet,
      colorClass: 'text-emerald-600 dark:text-emerald-400',
      bgClass: 'bg-emerald-500/10',
      isSpreadsheet: true,
      isImage: false,
      isPdf: false,
    };
  }
  if (name.endsWith('.pdf') || mime === 'application/pdf') {
    return {
      label: 'Documento PDF',
      Icon: FileText,
      colorClass: 'text-rose-500',
      bgClass: 'bg-rose-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: true,
    };
  }
  if (/\.(png|jpe?g|webp|gif|bmp|svg|ico)$/i.test(name) || mime.startsWith('image/')) {
    return {
      label: 'Imagem',
      Icon: ImageIcon,
      colorClass: 'text-violet-500',
      bgClass: 'bg-violet-500/10',
      isSpreadsheet: false,
      isImage: true,
      isPdf: false,
    };
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name) || mime.includes('zip')) {
    return {
      label: 'Arquivo Compactado',
      Icon: Archive,
      colorClass: 'text-amber-600 dark:text-amber-400',
      bgClass: 'bg-amber-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(name) || mime.startsWith('video/')) {
    return {
      label: 'Vídeo',
      Icon: Film,
      colorClass: 'text-cyan-500',
      bgClass: 'bg-cyan-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(name) || mime.startsWith('audio/')) {
    return {
      label: 'Áudio',
      Icon: Music,
      colorClass: 'text-pink-500',
      bgClass: 'bg-pink-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  if (/\.(docx?|odt|rtf)$/i.test(name)) {
    return {
      label: 'Documento Word',
      Icon: FileText,
      colorClass: 'text-blue-600 dark:text-blue-400',
      bgClass: 'bg-blue-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  if (/\.(txt|md|json|log|xml|ya?ml|ini|conf)$/i.test(name) || mime.startsWith('text/')) {
    return {
      label: 'Texto / Log',
      Icon: FileCode,
      colorClass: 'text-slate-600 dark:text-zinc-300',
      bgClass: 'bg-slate-500/10',
      isSpreadsheet: false,
      isImage: false,
      isPdf: false,
    };
  }
  return {
    label: 'Arquivo',
    Icon: FileIcon,
    colorClass: 'text-sky-500',
    bgClass: 'bg-sky-500/10',
    isSpreadsheet: false,
    isImage: false,
    isPdf: false,
  };
}

export default function WindowsFileExplorer({
  nodes = [],
  trashNodes = [],
  quotaInfo = { quotaBytes: 53687091200, usedBytes: 0, usagePercent: 0 },
  canWrite = false,
  canManageAcl = false,
  currentFolderId = null,
  onChangeFolder,
  showTrash = false,
  onOpenTrash,
  onCloseTrash,
  searchQuery = '',
  onChangeSearch,
  selectedNodeIds = [],
  onChangeSelectedIds,
  activeNode = null,
  nodeVersions = [],
  previewInfo = null,
  onClosePreview,
  onRefresh,
  onCreateFolder,
  onUploadFiles,
  onRenameNode,
  onMoveNode,
  onCopyNode,
  onPreviewNode,
  onDownloadNode,
  onDownloadZip,
  onToggleLock,
  onDeleteNodes,
  onLoadVersions,
  onRestoreVersion,
  onRestoreTrashNode,
  onPurgeTrashNode,
  onOpenSheet,
  onCreateSheet,
  shareLinks = [],
  onLoadShareLinks,
  onCreateShareLink,
  onRevokeShareLink,
  uploadingCount = 0,
}) {
  // Windows Explorer view & navigation state
  const [viewMode, setViewMode] = useState('details'); // 'details' | 'grid'
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'updatedAt' | 'type' | 'size'
  const [sortDir, setSortDir] = useState('asc');
  const [showDetailsPane, setShowDetailsPane] = useState(false);

  // Navigation history (Back / Forward)
  const [navHistory, setNavHistory] = useState([null]);
  const [navIndex, setNavIndex] = useState(0);

  // Left tree expansion state
  const [expandedFolders, setExpandedFolders] = useState({});

  // Inline create folder & inline rename (F2)
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState('');
  const [renamingNodeId, setRenamingNodeId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Internal clipboard (Cut / Copy / Paste)
  const [clipboard, setClipboard] = useState(null); // { mode: 'cut' | 'copy', nodeIds: string[] }

  // Drag & Drop (OS file upload + internal move)
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);

  // Context menu (right-click)
  const [contextMenu, setContextMenu] = useState(null); // { x, y, node | null }

  // Quick Share Link modal
  const [shareModalNode, setShareModalNode] = useState(null);
  const [shareExpiresHours, setShareExpiresHours] = useState(24);
  const [shareAllowDownload, setShareAllowDownload] = useState(true);
  const [sharePassword, setSharePassword] = useState('');
  const [createdShareUrl, setCreatedShareUrl] = useState('');

  const fileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const explorerRef = useRef(null);

  // Accessible nodes map
  const accessibleNodes = useMemo(
    () => nodes.filter((n) => n && n.effectiveAccess !== 'none' && !n.isTrashed && !n.is_trashed),
    [nodes],
  );

  const nodesById = useMemo(() => {
    const map = new Map();
    for (const n of accessibleNodes) map.set(n.id, n);
    return map;
  }, [accessibleNodes]);

  const folderChildrenMap = useMemo(() => {
    const map = new Map();
    for (const n of accessibleNodes) {
      if (!isFolderNode(n)) continue;
      const pid = getParentId(n);
      const effectiveParent = pid && nodesById.has(pid) ? pid : null;
      if (!map.has(effectiveParent)) map.set(effectiveParent, []);
      map.get(effectiveParent).push(n);
    }
    for (const [, list] of map) {
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { numeric: true }));
    }
    return map;
  }, [accessibleNodes, nodesById]);

  const rootFolders = useMemo(() => folderChildrenMap.get(null) || [], [folderChildrenMap]);

  // Breadcrumbs for current location
  const breadcrumbs = useMemo(() => {
    const trail = [{ id: null, label: 'Este Cofre (VPS)' }];
    if (showTrash) {
      trail.push({ id: '__TRASH__', label: 'Lixeira' });
      return trail;
    }
    const chain = [];
    let cursor = currentFolderId ? nodesById.get(currentFolderId) : null;
    const guard = new Set();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.unshift({ id: cursor.id, label: cursor.name });
      const pid = getParentId(cursor);
      cursor = pid ? nodesById.get(pid) : null;
    }
    return [...trail, ...chain];
  }, [currentFolderId, nodesById, showTrash]);

  // Current directory visible items (Folders first, then sorted files — authentic Windows Explorer!)
  const displayedNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = accessibleNodes.filter((n) => {
      if (q) {
        return (
          String(n.name || '').toLowerCase().includes(q) ||
          String(getNodePath(n)).toLowerCase().includes(q)
        );
      }
      const pid = getParentId(n);
      if (currentFolderId) {
        return pid === currentFolderId;
      }
      // At Root (/), display top-level nodes (or orphans whose parent isn't visible)
      return !pid || !nodesById.has(pid);
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aFolder = isFolderNode(a);
      const bFolder = isFolderNode(b);
      if (aFolder !== bFolder) return aFolder ? -1 : 1;

      if (sortBy === 'size') {
        const diff = Number(a.sizeBytes ?? a.size_bytes ?? 0) - Number(b.sizeBytes ?? b.size_bytes ?? 0);
        return diff !== 0 ? diff * dir : String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
      }
      if (sortBy === 'updatedAt') {
        const ta = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0).getTime();
        const tb = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0).getTime();
        return (ta - tb) * dir;
      }
      if (sortBy === 'type') {
        const ka = getFileKind(a).label;
        const kb = getFileKind(b).label;
        const cmp = ka.localeCompare(kb, 'pt-BR');
        return cmp !== 0 ? cmp * dir : String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
      }
      return (
        String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', {
          numeric: true,
          sensitivity: 'base',
        }) * dir
      );
    });
  }, [accessibleNodes, nodesById, currentFolderId, searchQuery, sortBy, sortDir]);

  const selectedNodes = useMemo(
    () => displayedNodes.filter((n) => selectedNodeIds.includes(n.id)),
    [displayedNodes, selectedNodeIds],
  );

  const primarySelectedNode = useMemo(() => {
    if (selectedNodes.length === 1) return selectedNodes[0];
    if (selectedNodes.length > 1) return selectedNodes[selectedNodes.length - 1];
    return null;
  }, [selectedNodes]);

  const inspectorNode = primarySelectedNode || (activeNode && nodesById.get(activeNode.id)) || null;

  const selectedTotalBytes = useMemo(
    () => selectedNodes.reduce((acc, n) => acc + Number(n.sizeBytes ?? n.size_bytes ?? 0), 0),
    [selectedNodes],
  );

  const currentFolderObj = currentFolderId ? nodesById.get(currentFolderId) || null : null;

  // Navigation helpers
  const navigateTo = useCallback(
    (target, { pushHistory = true } = {}) => {
      setContextMenu(null);
      setRenamingNodeId(null);
      setCreatingFolder(false);
      onChangeSelectedIds?.([]);
      if (searchQuery) onChangeSearch?.('');

      if (target === '__TRASH__') {
        onOpenTrash?.();
      } else {
        if (showTrash) onCloseTrash?.();
        onChangeFolder?.(target || null);
      }

      if (pushHistory) {
        setNavHistory((prev) => {
          const sliced = prev.slice(0, navIndex + 1);
          if (sliced[sliced.length - 1] === target) return sliced;
          return [...sliced, target];
        });
        setNavIndex((prev) => {
          const current = navHistory[prev];
          return current === target ? prev : prev + 1;
        });
      }
    },
    [navHistory, navIndex, onChangeFolder, onChangeSearch, onChangeSelectedIds, onCloseTrash, onOpenTrash, searchQuery, showTrash],
  );

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;
  const canGoUp = Boolean(showTrash || currentFolderId);

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const nextIdx = navIndex - 1;
    setNavIndex(nextIdx);
    navigateTo(navHistory[nextIdx], { pushHistory: false });
  }, [canGoBack, navHistory, navIndex, navigateTo]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const nextIdx = navIndex + 1;
    setNavIndex(nextIdx);
    navigateTo(navHistory[nextIdx], { pushHistory: false });
  }, [canGoForward, navHistory, navIndex, navigateTo]);

  const handleGoUp = useCallback(() => {
    if (showTrash) {
      navigateTo(null);
      return;
    }
    if (!currentFolderId) return;
    const parent = currentFolderObj ? getParentId(currentFolderObj) : null;
    navigateTo(parent && nodesById.has(parent) ? parent : null);
  }, [currentFolderId, currentFolderObj, navigateTo, nodesById, showTrash]);

  // Open node (Double-click / Enter / Filename button)
  const handleOpenNode = useCallback(
    (node) => {
      if (!node) return;
      if (isFolderNode(node)) {
        navigateTo(node.id);
        return;
      }
      const kind = getFileKind(node);
      if (kind.isSpreadsheet && onOpenSheet) {
        onOpenSheet(node);
        return;
      }
      onPreviewNode?.(node);
    },
    [navigateTo, onOpenSheet, onPreviewNode],
  );

  // Selection logic (Single-click, Ctrl+Click, Shift+Click like Windows Explorer)
  const handleRowSelect = (e, node, idx) => {
    if (e.target.closest('button, input, a')) return;
    setContextMenu(null);
    if (e.ctrlKey || e.metaKey) {
      const exists = selectedNodeIds.includes(node.id);
      onChangeSelectedIds?.(
        exists ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id],
      );
      return;
    }
    if (e.shiftKey && selectedNodeIds.length > 0) {
      const lastId = selectedNodeIds[selectedNodeIds.length - 1];
      const lastIdx = displayedNodes.findIndex((n) => n.id === lastId);
      if (lastIdx >= 0) {
        const start = Math.min(lastIdx, idx);
        const end = Math.max(lastIdx, idx);
        onChangeSelectedIds?.(displayedNodes.slice(start, end + 1).map((n) => n.id));
        return;
      }
    }
    onChangeSelectedIds?.([node.id]);
  };

  // Inline create folder
  const startCreateFolder = () => {
    if (!canWrite || showTrash) return;
    setCreatingFolder(true);
    setDraftFolderName('Nova pasta');
    setContextMenu(null);
    setTimeout(() => {
      newFolderInputRef.current?.focus();
      newFolderInputRef.current?.select();
    }, 20);
  };

  const commitCreateFolder = async (e) => {
    e?.preventDefault?.();
    const trimmed = draftFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      return;
    }
    const ok = await onCreateFolder?.(trimmed, currentFolderId);
    if (ok !== false) {
      setCreatingFolder(false);
      setDraftFolderName('');
    }
  };

  // Inline rename (F2)
  const startRename = useCallback(
    (node) => {
      if (!canWrite || !node || showTrash) return;
      setContextMenu(null);
      setRenamingNodeId(node.id);
      setRenameDraft(node.name || '');
      setTimeout(() => {
        const input = renameInputRef.current;
        if (input) {
          input.focus();
          const dotIdx = !isFolderNode(node) ? String(node.name || '').lastIndexOf('.') : -1;
          if (dotIdx > 0) {
            input.setSelectionRange(0, dotIdx);
          } else {
            input.select();
          }
        }
      }, 20);
    },
    [canWrite, showTrash],
  );

  const commitRename = async (node) => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === node.name) {
      setRenamingNodeId(null);
      return;
    }
    if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
      toast.error('Nome inválido: não utilize barras ou "..".');
      return;
    }
    await onRenameNode?.(node, trimmed);
    setRenamingNodeId(null);
  };

  // Clipboard Cut / Copy / Paste
  const handleSetClipboard = useCallback(
    (mode, items = selectedNodes) => {
      if (!canWrite || !items || items.length === 0) return;
      const ids = items.map((n) => n.id);
      setClipboard({ mode, nodeIds: ids });
      setContextMenu(null);
      toast.success(
        mode === 'cut'
          ? `${ids.length} item(ns) recortado(s). Abra a pasta destino e clique em Colar (Ctrl+V).`
          : `${ids.length} item(ns) copiado(s). Abra a pasta destino e clique em Colar (Ctrl+V).`,
      );
    },
    [canWrite, selectedNodes],
  );

  const handlePaste = useCallback(async () => {
    if (!canWrite || !clipboard || clipboard.nodeIds.length === 0 || showTrash) return;
    setContextMenu(null);
    const targetParentId = currentFolderId || null;
    for (const id of clipboard.nodeIds) {
      const src = nodesById.get(id);
      if (!src) continue;
      if (clipboard.mode === 'cut') {
        if (src.id === targetParentId || getParentId(src) === targetParentId) continue;
        await onMoveNode?.(src, targetParentId);
      } else {
        const sameFolder = (getParentId(src) || null) === targetParentId;
        const nameTaken = displayedNodes.some(
          (n) => String(n.name || '').toLowerCase() === String(src.name || '').toLowerCase(),
        );
        await onCopyNode?.(src, targetParentId, !sameFolder && !nameTaken ? src.name : undefined);
      }
    }
    if (clipboard.mode === 'cut') {
      setClipboard(null);
    }
  }, [canWrite, clipboard, currentFolderId, displayedNodes, nodesById, onCopyNode, onMoveNode, showTrash]);

  // Share link modal
  const openShareModal = (node) => {
    setContextMenu(null);
    setShareModalNode(node);
    setShareExpiresHours(24);
    setShareAllowDownload(true);
    setSharePassword('');
    setCreatedShareUrl('');
    onLoadShareLinks?.();
  };

  const handleSubmitShareLink = async (e) => {
    e?.preventDefault?.();
    if (!shareModalNode || !onCreateShareLink) return;
    const res = await onCreateShareLink({
      nodeId: shareModalNode.id,
      expiresInHours: Number(shareExpiresHours || 24),
      allowDownload: Boolean(shareAllowDownload),
      password: sharePassword.trim() || undefined,
    });
    const url = res?.shareUrl || res?.url || res?.link?.url || '';
    if (url) {
      setCreatedShareUrl(url);
    }
    setSharePassword('');
  };

  // Drag & Drop handlers (External OS Files + Internal Move)
  const handlePaneDragOver = (e) => {
    if (showTrash || !canWrite) return;
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (hasFiles) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isExternalDragOver) setIsExternalDragOver(true);
    }
  };

  const handlePaneDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsExternalDragOver(false);
  };

  const handlePaneDrop = async (e) => {
    e.preventDefault();
    setIsExternalDragOver(false);
    setDragOverFolderId(null);
    if (showTrash || !canWrite) return;

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await onUploadFiles?.(files, currentFolderId);
      return;
    }
  };

  const handleItemDragStart = (e, node) => {
    if (!canWrite || showTrash) return;
    e.dataTransfer.setData('application/x-nexus-node-id', node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDrop = async (e, targetFolderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
    setIsExternalDragOver(false);
    if (!canWrite || showTrash) return;

    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await onUploadFiles?.(files, targetFolderId);
      return;
    }

    const draggedId = e.dataTransfer?.getData('application/x-nexus-node-id');
    if (!draggedId || draggedId === targetFolderId) return;
    const draggedNode = nodesById.get(draggedId);
    if (!draggedNode || getParentId(draggedNode) === targetFolderId) return;
    await onMoveNode?.(draggedNode, targetFolderId);
  };

  // Context menu trigger
  const openContextMenu = (e, node = null) => {
    e.preventDefault();
    e.stopPropagation();
    if (node && !selectedNodeIds.includes(node.id)) {
      onChangeSelectedIds?.([node.id]);
    }
    const maxW = typeof window !== 'undefined' ? window.innerWidth - 230 : 800;
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 340 : 500;
    setContextMenu({
      x: Math.max(12, Math.min(e.clientX, maxW)),
      y: Math.max(12, Math.min(e.clientY, maxH)),
      node,
    });
  };

  // Close context menu on global click
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Windows Explorer keyboard shortcuts
  const handleKeyDown = (e) => {
    const tag = String(e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (e.key === 'Escape') {
      setContextMenu(null);
      setCreatingFolder(false);
      setRenamingNodeId(null);
      if (clipboard) setClipboard(null);
      else onChangeSelectedIds?.([]);
      return;
    }
    if (e.key === 'F2' && primarySelectedNode && canWrite && !showTrash) {
      e.preventDefault();
      startRename(primarySelectedNode);
      return;
    }
    if (e.key === 'Delete' && selectedNodes.length > 0 && canWrite && !showTrash) {
      e.preventDefault();
      onDeleteNodes?.(selectedNodes);
      return;
    }
    if (e.key === 'Enter' && primarySelectedNode && !showTrash) {
      e.preventDefault();
      handleOpenNode(primarySelectedNode);
      return;
    }
    if ((e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) && canGoUp) {
      e.preventDefault();
      handleGoUp();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedNodes.length > 0) {
      e.preventDefault();
      handleSetClipboard('copy', selectedNodes);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && selectedNodes.length > 0) {
      e.preventDefault();
      handleSetClipboard('cut', selectedNodes);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard) {
      e.preventDefault();
      handlePaste();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !showTrash) {
      e.preventDefault();
      onChangeSelectedIds?.(displayedNodes.map((n) => n.id));
    }
  };

  // Column sort toggle
  const handleSortClick = (field) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  // Recursive sidebar folder tree renderer (only uses friendly Quick Access names at root to keep clean Windows UX)
  const renderTreeFolder = (folder, depth = 0) => {
    const children = folderChildrenMap.get(folder.id) || [];
    const isExpanded = Boolean(expandedFolders[folder.id]);
    const isCurrent = !showTrash && currentFolderId === folder.id;
    const isDropTarget = dragOverFolderId === `tree-${folder.id}`;
    const label = depth === 0 ? QUICK_ACCESS_ALIASES[getNodePath(folder)] || folder.name : folder.name;

    return (
      <div key={folder.id}>
        <div
          onDragOver={(e) => {
            if (!canWrite) return;
            e.preventDefault();
            setDragOverFolderId(`tree-${folder.id}`);
          }}
          onDragLeave={() => setDragOverFolderId(null)}
          onDrop={(e) => handleFolderDrop(e, folder.id)}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className={`group flex items-center gap-1 pr-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            isDropTarget
              ? 'bg-brand/20 ring-1 ring-brand text-brand-aa font-bold'
              : isCurrent
                ? 'bg-brand/15 text-brand-aa font-bold'
                : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800/80'
          }`}
        >
          {children.length > 0 ? (
            <button
              type="button"
              aria-label={isExpanded ? `Recolher ${label}` : `Expandir ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                setExpandedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }));
              }}
              className="p-0.5 rounded hover:bg-slate-300/60 dark:hover:bg-zinc-700"
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            type="button"
            title={getNodePath(folder)}
            onClick={() => navigateTo(folder.id)}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          >
            {isCurrent ? (
              <FolderOpen size={14} className="text-amber-500 shrink-0" />
            ) : (
              <Folder size={14} className="text-amber-500 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </button>
        </div>
        {isExpanded && children.map((child) => renderTreeFolder(child, depth + 1))}
      </div>
    );
  };

  const allVisibleSelected =
    displayedNodes.length > 0 && displayedNodes.every((n) => selectedNodeIds.includes(n.id));
  const primaryCanDownload = primarySelectedNode && !isFolderNode(primarySelectedNode) && primarySelectedNode.effectiveAccess !== 'viewer_online';
  const primaryLockedBy = primarySelectedNode ? getLockedBy(primarySelectedNode) : null;

  return (
    <div
      ref={explorerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Explorador de Arquivos Windows Nexus Vault"
      className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {/* ROW 1: WINDOWS 11 COMMAND BAR (RIBBON) */}
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {canWrite && !showTrash && (
            <>
              <button
                type="button"
                onClick={startCreateFolder}
                className="min-h-[34px] px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-bold flex items-center gap-1.5 shadow-sm hover:opacity-95"
              >
                <FolderPlus size={14} />
                <span>Nova Pasta</span>
              </button>

              <label className="min-h-[34px] px-3 py-1.5 rounded-lg border border-brand/40 bg-brand/10 text-brand-aa text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-brand/15">
                <UploadCloud size={14} />
                <span>{uploadingCount > 0 ? `Enviando (${uploadingCount})...` : 'Enviar Arquivos'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  aria-label="Upload de arquivo"
                  onChange={(e) => {
                    const files = Array.from(e.target?.files || []);
                    if (files.length > 0) onUploadFiles?.(files, currentFolderId);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>

              {onCreateSheet && (
                <button
                  type="button"
                  onClick={() => onCreateSheet(currentFolderId)}
                  title="Criar nova planilha colaborativa nesta pasta"
                  className="min-h-[34px] px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-500/15"
                >
                  <FileSpreadsheet size={14} />
                  <span className="hidden sm:inline">Nova Planilha</span>
                </button>
              )}

              <span className="h-5 w-px bg-slate-200 dark:bg-zinc-700 mx-0.5 hidden sm:inline-block" />
            </>
          )}

          {/* Windows Selection Actions (Cut / Copy / Paste / Rename / Download / Delete) */}
          {!showTrash && (
            <div className="flex items-center gap-1">
              {canWrite && (
                <>
                  <button
                    type="button"
                    disabled={selectedNodes.length === 0}
                    onClick={() => handleSetClipboard('cut')}
                    title="Recortar (Ctrl+X)"
                    aria-label="Recortar"
                    className="p-2 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <Scissors size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={selectedNodes.length === 0}
                    onClick={() => handleSetClipboard('copy')}
                    title="Copiar (Ctrl+C)"
                    aria-label="Copiar"
                    className="p-2 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={!clipboard}
                    onClick={handlePaste}
                    title="Colar nesta pasta (Ctrl+V)"
                    aria-label="Colar"
                    className={`p-2 rounded-lg transition-colors disabled:opacity-35 disabled:pointer-events-none ${
                      clipboard
                        ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30'
                        : 'text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <ClipboardPaste size={15} />
                  </button>
                  <button
                    type="button"
                    disabled={!primarySelectedNode}
                    onClick={() => startRename(primarySelectedNode)}
                    title="Renomear (F2)"
                    aria-label="Renomear"
                    className="p-2 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none"
                  >
                    <Pencil size={15} />
                  </button>
                </>
              )}

              {primaryCanDownload && (
                <button
                  type="button"
                  onClick={() => onDownloadNode?.(primarySelectedNode)}
                  title="Baixar arquivo selecionado"
                  aria-label="Baixar selecionado"
                  className="p-2 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                >
                  <Download size={15} />
                </button>
              )}

              <button
                type="button"
                onClick={() => onDownloadZip?.(selectedNodeIds)}
                title="Baixar seleção em pacote ZIP"
                aria-label="Baixar ZIP"
                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-1"
              >
                <Archive size={14} />
                <span className="hidden md:inline">ZIP</span>
              </button>

              {canManageAcl && primarySelectedNode && !isFolderNode(primarySelectedNode) && (
                <button
                  type="button"
                  onClick={() => openShareModal(primarySelectedNode)}
                  title="Gerar link temporário de compartilhamento"
                  aria-label="Compartilhar link"
                  className="p-2 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                >
                  <Link2 size={15} />
                </button>
              )}

              {canWrite && primarySelectedNode && !isFolderNode(primarySelectedNode) && (
                <button
                  type="button"
                  onClick={() => onToggleLock?.(primarySelectedNode)}
                  title={primaryLockedBy ? `Desbloquear (travado por ${primaryLockedBy})` : 'Bloquear para edição exclusiva'}
                  aria-label={primaryLockedBy ? 'Desbloquear arquivo' : 'Bloquear arquivo'}
                  className={`p-2 rounded-lg transition-colors ${
                    primaryLockedBy
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'text-slate-700 dark:text-zinc-200 hover:bg-slate-200/70 dark:hover:bg-zinc-800'
                  }`}
                >
                  {primaryLockedBy ? <Unlock size={15} /> : <Lock size={15} />}
                </button>
              )}

              {canWrite && (
                <button
                  type="button"
                  disabled={selectedNodes.length === 0}
                  onClick={() => onDeleteNodes?.(selectedNodes)}
                  title="Mover para a Lixeira (Delete)"
                  aria-label="Excluir selecionados"
                  className="p-2 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-35 disabled:pointer-events-none"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Sort, View Mode, Details Pane, Refresh */}
        <div className="flex items-center gap-1.5">
          {!showTrash && (
            <select
              aria-label="Classificar arquivos por"
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':');
                setSortBy(field);
                setSortDir(dir);
              }}
              className="min-h-[34px] px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-zinc-200"
            >
              <option value="name:asc">Nome (A–Z)</option>
              <option value="name:desc">Nome (Z–A)</option>
              <option value="updatedAt:desc">Mais recentes</option>
              <option value="size:desc">Maior tamanho</option>
              <option value="type:asc">Tipo</option>
            </select>
          )}

          <div className="inline-flex rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('details')}
              title="Exibir como Detalhes (Lista)"
              aria-label="Visualização Detalhes"
              aria-pressed={viewMode === 'details'}
              className={`p-1.5 rounded-md ${
                viewMode === 'details' ? 'bg-brand text-brand-fg' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
              }`}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Exibir como Ícones Grandes"
              aria-label="Visualização Ícones Grandes"
              aria-pressed={viewMode === 'grid'}
              className={`p-1.5 rounded-md ${
                viewMode === 'grid' ? 'bg-brand text-brand-fg' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
              }`}
            >
              <LayoutGrid size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowDetailsPane((prev) => !prev)}
            title="Alternar Painel de Detalhes"
            aria-label="Painel de Detalhes"
            aria-pressed={showDetailsPane}
            className={`p-2 rounded-lg border text-xs ${
              showDetailsPane
                ? 'border-brand/40 bg-brand/10 text-brand-aa'
                : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300'
            }`}
          >
            <PanelRight size={14} />
          </button>

          <button
            type="button"
            onClick={() => onRefresh?.()}
            title="Atualizar diretório"
            aria-label="Atualizar diretório"
            className="p-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ROW 2: WINDOWS NAVIGATION & ADDRESS BAR (← → ↑ | Breadcrumbs | Search) */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={handleGoBack}
            title="Voltar"
            aria-label="Voltar pasta anterior"
            className="p-1.5 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={handleGoForward}
            title="Avançar"
            aria-label="Avançar pasta"
            className="p-1.5 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            disabled={!canGoUp}
            onClick={handleGoUp}
            title="Subir um nível (Backspace)"
            aria-label="Subir um nível"
            className="p-1.5 rounded-lg text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowUp size={15} />
          </button>
        </div>

        {/* Clickable Address Bar */}
        <nav
          aria-label="Caminho do diretório atual"
          className="flex-1 min-w-[200px] min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 flex items-center gap-1 overflow-x-auto text-xs"
        >
          <HardDrive size={14} className="text-brand-aa shrink-0 mr-1" />
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={`${crumb.id ?? 'root'}-${idx}`}>
                {idx > 0 && <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                <button
                  type="button"
                  onClick={() => navigateTo(crumb.id)}
                  onDragOver={(e) => {
                    if (crumb.id === '__TRASH__' || !canWrite) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (crumb.id === '__TRASH__') return;
                    handleFolderDrop(e, crumb.id);
                  }}
                  className={`px-1.5 py-0.5 rounded hover:bg-slate-200/80 dark:hover:bg-zinc-800 whitespace-nowrap ${
                    isLast ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-zinc-300'
                  }`}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        {/* Contextual Search */}
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="search"
            aria-label="Buscar arquivos no cofre"
            placeholder={`Pesquisar em ${breadcrumbs[breadcrumbs.length - 1]?.label || 'Este Cofre'}...`}
            value={searchQuery}
            onChange={(e) => onChangeSearch?.(e.target.value)}
            className="w-full min-h-[34px] pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-xs text-slate-900 dark:text-white"
          />
        </div>
      </div>

      {/* CLIPBOARD BANNER */}
      {clipboard && (
        <div className="px-4 py-2 bg-sky-500/10 border-b border-sky-500/20 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-800 dark:text-sky-200">
          <span className="font-semibold">
            {clipboard.nodeIds.length} item(ns) {clipboard.mode === 'cut' ? 'recortado(s)' : 'copiado(s)'}. Navegue até o destino e clique em <strong>Colar</strong> ou pressione <kbd className="px-1 py-0.5 rounded bg-sky-500/20 font-mono text-[10px]">Ctrl+V</kbd>.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePaste}
              className="px-2.5 py-1 rounded-md bg-sky-600 text-white font-bold"
            >
              Colar Aqui
            </button>
            <button
              type="button"
              onClick={() => setClipboard(null)}
              className="px-2 py-1 rounded-md border border-sky-500/30 font-semibold"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* 3-PANE WINDOWS EXPLORER BODY */}
      <div className="flex flex-col lg:flex-row min-h-[460px]">
        {/* LEFT PANE: NAVIGATION TREE (ACESSO RÁPIDO & LIXEIRA) */}
        <aside className="lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/30 p-2.5 flex flex-col justify-between gap-4">
          <div className="space-y-1">
            <p className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Acesso Rápido
            </p>
            <button
              type="button"
              onClick={() => navigateTo(null)}
              onDragOver={(e) => {
                if (!canWrite) return;
                e.preventDefault();
                setDragOverFolderId('tree-root');
              }}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleFolderDrop(e, null)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                dragOverFolderId === 'tree-root'
                  ? 'bg-brand/20 ring-1 ring-brand text-brand-aa font-bold'
                  : !showTrash && !currentFolderId
                    ? 'bg-brand/15 text-brand-aa font-bold'
                    : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800/80'
              }`}
            >
              <HardDrive size={14} className="shrink-0" />
              <span>Este Cofre (Raiz)</span>
            </button>

            <div className="space-y-0.5 pt-1">
              {rootFolders.map((folder) => renderTreeFolder(folder, 0))}
            </div>

            <div className="my-2 border-t border-slate-200 dark:border-zinc-800" />

            <button
              type="button"
              onClick={() => navigateTo('__TRASH__')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                showTrash
                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 font-bold'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800/80'
              }`}
            >
              <span className="flex items-center gap-2">
                <Trash2 size={14} className="shrink-0" />
                <span>Lixeira</span>
              </span>
              {trashNodes.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500/15">
                  {trashNodes.length}
                </span>
              )}
            </button>
          </div>

          {/* Windows-Style Local Disk Gauge */}
          <div className="hidden lg:block rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-zinc-200">
              <HardDrive size={13} className="text-brand-aa" />
              <span>Disco VPS</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  quotaInfo.usagePercent >= 90
                    ? 'bg-rose-500'
                    : quotaInfo.usagePercent >= 80
                      ? 'bg-amber-500'
                      : 'bg-sky-500'
                }`}
                style={{ width: `${Math.min(100, quotaInfo.usagePercent || 0)}%` }}
              />
            </div>
            <p className="text-[10px] font-mono text-slate-500">
              {formatBytes(Math.max(0, Number(quotaInfo.quotaBytes || 0) - Number(quotaInfo.usedBytes || 0)))} livres de{' '}
              {formatBytes(quotaInfo.quotaBytes)}
            </p>
          </div>
        </aside>

        {/* CENTER PANE: FILE LIST / GRID WITH DRAG-DROP & CONTEXT MENU */}
        <div
          onDragOver={handlePaneDragOver}
          onDragLeave={handlePaneDragLeave}
          onDrop={handlePaneDrop}
          onContextMenu={(e) => {
            if (!showTrash) openContextMenu(e, null);
          }}
          className="relative flex-1 min-w-0 flex flex-col bg-white dark:bg-[#111113]"
        >
          {/* OS File Drag & Drop Overlay */}
          {isExternalDragOver && (
            <div className="absolute inset-2 z-30 rounded-xl border-2 border-dashed border-brand bg-brand/10 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 pointer-events-none">
              <UploadCloud size={36} className="text-brand-aa" />
              <p className="text-sm font-black text-slate-900 dark:text-white">
                Solte os arquivos aqui para enviar
              </p>
              <p className="text-xs text-slate-600 dark:text-zinc-300">
                Destino: {currentFolderObj ? getNodePath(currentFolderObj) : '/ (Raiz do Cofre)'}
              </p>
            </div>
          )}

          {!showTrash ? (
            <div className="flex-1 overflow-auto">
              {/* Inline New Folder Row */}
              {creatingFolder && (
                <form
                  onSubmit={commitCreateFolder}
                  className="mx-3 mt-3 mb-1 px-3 py-2 rounded-xl border border-brand/40 bg-brand/5 flex items-center gap-2"
                >
                  <Folder size={18} className="text-amber-500 shrink-0" />
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    aria-label="Nome da nova pasta"
                    value={draftFolderName}
                    onChange={(e) => setDraftFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setCreatingFolder(false);
                      }
                    }}
                    placeholder="Digite o nome da pasta..."
                    className="flex-1 min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-bold flex items-center gap-1"
                  >
                    <Check size={13} />
                    <span>Criar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(false)}
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                    aria-label="Cancelar nova pasta"
                  >
                    <X size={14} />
                  </button>
                </form>
              )}

              {displayedNodes.length === 0 ? (
                <div className="py-16 px-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-900 mx-auto flex items-center justify-center">
                    <FolderOpen size={24} className="text-slate-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-700 dark:text-zinc-200">
                      {searchQuery
                        ? `Nenhum item encontrado para "${searchQuery}".`
                        : 'Esta pasta está vazia.'}
                    </p>
                    {canWrite && !searchQuery && (
                      <p className="text-xs text-slate-500">
                        Arraste arquivos do seu computador para cá, clique com o botão direito ou use <strong>Nova Pasta</strong> / <strong>Enviar Arquivos</strong> acima.
                      </p>
                    )}
                  </div>
                </div>
              ) : viewMode === 'details' ? (
                /* DETAILS VIEW (CLASSIC WINDOWS TABLE) */
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-zinc-900/95 border-b border-slate-200 dark:border-zinc-800 text-[11px] font-bold text-slate-500 dark:text-zinc-400 select-none">
                    <tr>
                      <th className="w-9 py-2 pl-3 pr-1">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os itens"
                          checked={allVisibleSelected}
                          onChange={(e) =>
                            onChangeSelectedIds?.(e.target.checked ? displayedNodes.map((n) => n.id) : [])
                          }
                        />
                      </th>
                      <th className="py-2 px-2">
                        <button
                          type="button"
                          onClick={() => handleSortClick('name')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Nome</span>
                          {sortBy === 'name' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      </th>
                      <th className="py-2 px-2 hidden md:table-cell w-36">
                        <button
                          type="button"
                          onClick={() => handleSortClick('updatedAt')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Modificado em</span>
                          {sortBy === 'updatedAt' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      </th>
                      <th className="py-2 px-2 hidden sm:table-cell w-32">
                        <button
                          type="button"
                          onClick={() => handleSortClick('type')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Tipo</span>
                          {sortBy === 'type' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      </th>
                      <th className="py-2 px-2 hidden sm:table-cell w-24 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortClick('size')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white ml-auto"
                        >
                          <span>Tamanho</span>
                          {sortBy === 'size' && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      </th>
                      <th className="py-2 pl-2 pr-3 text-right w-40">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/70 text-xs">
                    {displayedNodes.map((node, idx) => {
                      const folder = isFolderNode(node);
                      const kind = getFileKind(node);
                      const KindIcon = kind.Icon;
                      const isSelected = selectedNodeIds.includes(node.id);
                      const isCut = clipboard?.mode === 'cut' && clipboard.nodeIds.includes(node.id);
                      const isDropTarget = folder && dragOverFolderId === node.id;
                      const lockedBy = getLockedBy(node);
                      const isViewerOnline = node.effectiveAccess === 'viewer_online';
                      const isRenaming = renamingNodeId === node.id;

                      return (
                        <tr
                          key={node.id}
                          data-testid={`vfs-node-${node.name}`}
                          draggable={canWrite && !isRenaming}
                          onDragStart={(e) => handleItemDragStart(e, node)}
                          onDragOver={(e) => {
                            if (!folder || !canWrite) return;
                            e.preventDefault();
                            setDragOverFolderId(node.id);
                          }}
                          onDragLeave={() => {
                            if (dragOverFolderId === node.id) setDragOverFolderId(null);
                          }}
                          onDrop={(e) => {
                            if (folder) handleFolderDrop(e, node.id);
                          }}
                          onClick={(e) => handleRowSelect(e, node, idx)}
                          onDoubleClick={() => handleOpenNode(node)}
                          onContextMenu={(e) => openContextMenu(e, node)}
                          className={`group select-none cursor-default transition-colors ${
                            isCut ? 'opacity-50' : ''
                          } ${
                            isDropTarget
                              ? 'bg-brand/20 ring-1 ring-inset ring-brand'
                              : isSelected
                                ? 'bg-brand/10 dark:bg-brand/15'
                                : 'hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                          }`}
                        >
                          <td className="py-2 pl-3 pr-1">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ${node.name}`}
                              checked={isSelected}
                              onChange={(e) => {
                                onChangeSelectedIds?.(
                                  e.target.checked
                                    ? [...new Set([...selectedNodeIds, node.id])]
                                    : selectedNodeIds.filter((id) => id !== node.id),
                                );
                              }}
                            />
                          </td>

                          <td className="py-2 px-2 max-w-[280px]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className={`w-7 h-7 rounded-lg ${kind.bgClass} flex items-center justify-center shrink-0`}>
                                <KindIcon size={16} className={kind.colorClass} />
                              </span>
                              <div className="min-w-0 flex-1">
                                {isRenaming ? (
                                  <input
                                    ref={renameInputRef}
                                    type="text"
                                    aria-label="Novo nome do item"
                                    value={renameDraft}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    onBlur={() => commitRename(node)}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') commitRename(node);
                                      if (e.key === 'Escape') setRenamingNodeId(null);
                                    }}
                                    className="w-full px-2 py-0.5 rounded border border-brand bg-white dark:bg-zinc-900 text-xs font-bold"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenNode(node);
                                    }}
                                    className="font-bold text-slate-900 dark:text-zinc-100 hover:underline truncate block text-left max-w-full"
                                  >
                                    {node.name}
                                  </button>
                                )}
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {searchQuery && (
                                    <span className="text-[10px] font-mono text-slate-400 truncate">
                                      {getNodePath(node)}
                                    </span>
                                  )}
                                  {lockedBy && (
                                    <span
                                      data-testid={`lock-badge-${node.id}`}
                                      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                    >
                                      <Lock size={10} />
                                      <span>Em edição por {lockedBy}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-2 px-2 text-[11px] text-slate-500 dark:text-zinc-400 hidden md:table-cell whitespace-nowrap">
                            {formatDateTime(node.updatedAt || node.updated_at || node.createdAt || node.created_at)}
                          </td>

                          <td className="py-2 px-2 text-[11px] text-slate-500 dark:text-zinc-400 hidden sm:table-cell whitespace-nowrap">
                            {kind.label}
                          </td>

                          <td className="py-2 px-2 text-[11px] font-mono text-slate-500 dark:text-zinc-400 hidden sm:table-cell text-right whitespace-nowrap">
                            {folder ? '' : formatBytes(node.sizeBytes ?? node.size_bytes)}
                          </td>

                          <td className="py-2 pl-2 pr-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1">
                              {!folder && (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onPreviewNode?.(node);
                                    }}
                                    title="Visualizar arquivo"
                                    aria-label={`Visualizar ${node.name}`}
                                    className="p-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                                  >
                                    <Eye size={14} />
                                  </button>
                                  {!isViewerOnline && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDownloadNode?.(node);
                                      }}
                                      title="Baixar arquivo"
                                      aria-label={`Baixar ${node.name}`}
                                      className="p-1.5 rounded-lg text-slate-600 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                                    >
                                      <Download size={14} />
                                    </button>
                                  )}
                                </>
                              )}
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteNodes?.([node]);
                                  }}
                                  title="Excluir (enviar para Lixeira)"
                                  aria-label={`Excluir ${node.name}`}
                                  className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => openContextMenu(e, node)}
                                title="Mais opções (ou clique com botão direito)"
                                aria-label={`Mais ações para ${node.name}`}
                                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                              >
                                <MoreVertical size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                /* LARGE ICONS / GRID VIEW (WINDOWS 11 TILES) */
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {displayedNodes.map((node, idx) => {
                    const folder = isFolderNode(node);
                    const kind = getFileKind(node);
                    const KindIcon = kind.Icon;
                    const isSelected = selectedNodeIds.includes(node.id);
                    const isCut = clipboard?.mode === 'cut' && clipboard.nodeIds.includes(node.id);
                    const isDropTarget = folder && dragOverFolderId === node.id;
                    const lockedBy = getLockedBy(node);
                    const isRenaming = renamingNodeId === node.id;

                    return (
                      <div
                        key={node.id}
                        data-testid={`vfs-node-${node.name}`}
                        draggable={canWrite && !isRenaming}
                        onDragStart={(e) => handleItemDragStart(e, node)}
                        onDragOver={(e) => {
                          if (!folder || !canWrite) return;
                          e.preventDefault();
                          setDragOverFolderId(node.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverFolderId === node.id) setDragOverFolderId(null);
                        }}
                        onDrop={(e) => {
                          if (folder) handleFolderDrop(e, node.id);
                        }}
                        onClick={(e) => handleRowSelect(e, node, idx)}
                        onDoubleClick={() => handleOpenNode(node)}
                        onContextMenu={(e) => openContextMenu(e, node)}
                        className={`group relative rounded-xl border p-3 flex flex-col items-center text-center gap-2 select-none cursor-default transition-all ${
                          isCut ? 'opacity-50' : ''
                        } ${
                          isDropTarget
                            ? 'border-brand bg-brand/20 ring-2 ring-brand'
                            : isSelected
                              ? 'border-brand/50 bg-brand/10 dark:bg-brand/15 shadow-sm'
                              : 'border-transparent hover:border-slate-200 dark:hover:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-900/60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${node.name}`}
                          checked={isSelected}
                          onChange={(e) => {
                            onChangeSelectedIds?.(
                              e.target.checked
                                ? [...new Set([...selectedNodeIds, node.id])]
                                : selectedNodeIds.filter((id) => id !== node.id),
                            );
                          }}
                          className={`absolute top-2 left-2 transition-opacity ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={(e) => openContextMenu(e, node)}
                          aria-label={`Mais ações para ${node.name}`}
                          className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-200/80 dark:hover:bg-zinc-800 text-slate-500"
                        >
                          <MoreVertical size={13} />
                        </button>

                        <div className={`w-14 h-14 rounded-2xl ${kind.bgClass} flex items-center justify-center mt-1`}>
                          <KindIcon size={32} className={kind.colorClass} />
                        </div>

                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            aria-label="Novo nome do item"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => commitRename(node)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitRename(node);
                              if (e.key === 'Escape') setRenamingNodeId(null);
                            }}
                            className="w-full px-2 py-0.5 rounded border border-brand bg-white dark:bg-zinc-900 text-xs font-bold text-center"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenNode(node);
                            }}
                            className="text-xs font-bold text-slate-900 dark:text-zinc-100 line-clamp-2 break-all hover:underline"
                          >
                            {node.name}
                          </button>
                        )}

                        <span className="text-[10px] text-slate-500 font-mono">
                          {folder ? 'Pasta' : formatBytes(node.sizeBytes ?? node.size_bytes)}
                        </span>

                        {lockedBy && (
                          <span
                            data-testid={`lock-badge-${node.id}`}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 max-w-full truncate"
                          >
                            <Lock size={9} className="shrink-0" />
                            <span className="truncate">{lockedBy}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* RECYCLE BIN VIEW (LIXEIRA WINDOWS) */
            <div className="flex-1 p-4 space-y-3 overflow-auto">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
                <span>
                  Itens na Lixeira (.nexus_trash) ficam retidos por até <strong>30 dias</strong> antes da limpeza definitiva.
                </span>
                <button
                  type="button"
                  onClick={() => navigateTo(null)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-amber-500/30 text-xs font-bold"
                >
                  Voltar ao Cofre
                </button>
              </div>

              {trashNodes.length === 0 ? (
                <div className="py-14 text-center space-y-2">
                  <Trash2 size={28} className="mx-auto text-slate-300 dark:text-zinc-700" />
                  <p className="text-xs font-semibold text-slate-500">A lixeira está vazia.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  {trashNodes.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 px-3 bg-white dark:bg-[#111113] hover:bg-slate-50 dark:hover:bg-zinc-900/50 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-white truncate">{t.name}</p>
                        <p className="text-[11px] font-mono text-slate-500 truncate">
                          Origem: {t.originalVirtualPath || t.virtualPath || '/'} • {formatBytes(t.sizeBytes ?? t.size_bytes)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRestoreTrashNode?.(t.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                        >
                          <RotateCcw size={12} />
                          <span>Restaurar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onPurgeTrashNode?.(t.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold inline-flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          <span>Expurgar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANE: WINDOWS 11 DETAILS & VERSIONS INSPECTOR */}
        {showDetailsPane && !showTrash && (
          <aside className="lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/30 p-4 space-y-4 overflow-auto">
            {inspectorNode ? (
              (() => {
                const kind = getFileKind(inspectorNode);
                const KindIcon = kind.Icon;
                const folder = isFolderNode(inspectorNode);
                const lockedBy = getLockedBy(inspectorNode);
                const isViewerOnline = inspectorNode.effectiveAccess === 'viewer_online';
                return (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className={`w-12 h-12 rounded-2xl ${kind.bgClass} flex items-center justify-center`}>
                        <KindIcon size={26} className={kind.colorClass} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDetailsPane(false)}
                        aria-label="Fechar painel de detalhes"
                        className="p-1 rounded-lg text-slate-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div>
                      <h4 className="text-sm font-black text-slate-900 dark:text-white break-words">
                        {inspectorNode.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">{kind.label}</p>
                    </div>

                    <div className="space-y-1.5 text-[11px] border-t border-slate-200 dark:border-zinc-800 pt-3">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Caminho</span>
                        <span className="font-mono text-right truncate max-w-[160px]" title={getNodePath(inspectorNode)}>
                          {getNodePath(inspectorNode)}
                        </span>
                      </div>
                      {!folder && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Tamanho</span>
                            <span className="font-mono font-bold">{formatBytes(inspectorNode.sizeBytes ?? inspectorNode.size_bytes)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Versão atual</span>
                            <span className="font-mono font-bold">v{inspectorNode.currentVersion || inspectorNode.current_version || 1}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Seu acesso</span>
                        <span className="font-semibold text-slate-800 dark:text-zinc-200">
                          {ACCESS_LABELS_PT[inspectorNode.effectiveAccess] || inspectorNode.effectiveAccess || 'Controle Total'}
                        </span>
                      </div>
                      {lockedBy && (
                        <div className="rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2.5 py-1.5 font-semibold flex items-center gap-1.5 mt-2">
                          <Lock size={12} />
                          <span className="truncate">Travado por {lockedBy}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {!folder && (
                        <button
                          type="button"
                          onClick={() => onPreviewNode?.(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <Eye size={13} />
                          <span>Visualizar</span>
                        </button>
                      )}
                      {!folder && !isViewerOnline && (
                        <button
                          type="button"
                          onClick={() => onDownloadNode?.(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <Download size={13} />
                          <span>Baixar</span>
                        </button>
                      )}
                      {!folder && kind.isSpreadsheet && onOpenSheet && (
                        <button
                          type="button"
                          onClick={() => onOpenSheet(inspectorNode)}
                          className="col-span-2 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <FileSpreadsheet size={13} />
                          <span>Abrir no Editor Ao Vivo</span>
                        </button>
                      )}
                      {!folder && (
                        <button
                          type="button"
                          onClick={() => onLoadVersions?.(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          <History size={13} />
                          <span>Versões</span>
                        </button>
                      )}
                      {!folder && canWrite && (
                        <button
                          type="button"
                          onClick={() => onToggleLock?.(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          {lockedBy ? <Unlock size={13} /> : <Lock size={13} />}
                          <span>{lockedBy ? 'Destravar' : 'Travar'}</span>
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => startRename(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          <Pencil size={13} />
                          <span>Renomear</span>
                        </button>
                      )}
                      {!folder && canManageAcl && (
                        <button
                          type="button"
                          onClick={() => openShareModal(inspectorNode)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          <Link2 size={13} />
                          <span>Link Temp.</span>
                        </button>
                      )}
                    </div>

                    {nodeVersions.length > 0 && activeNode?.id === inspectorNode.id && (
                      <div className="border-t border-slate-200 dark:border-zinc-800 pt-3 space-y-2">
                        <h5 className="text-[11px] font-black uppercase text-slate-500">Histórico de Versões</h5>
                        {nodeVersions.map((v) => {
                          const verNum = v.versionNumber || v.version_number;
                          return (
                            <div
                              key={v.id || verNum}
                              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-2 text-[11px] flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="font-bold">v{verNum}</span> •{' '}
                                <span className="font-mono text-slate-500">{formatBytes(v.sizeBytes || v.size_bytes)}</span>
                              </div>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => onRestoreVersion?.(inspectorNode.id, verNum)}
                                  className="px-2 py-0.5 rounded border border-brand/40 text-brand-aa font-bold shrink-0"
                                >
                                  Restaurar
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <div className="text-center py-10 space-y-2">
                <Folder size={28} className="mx-auto text-amber-500" />
                <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                  {currentFolderObj ? currentFolderObj.name : 'Este Cofre (Raiz)'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Selecione um arquivo ou pasta para ver propriedades, versões e ações rápidas.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* VERSIONS PANEL (WHEN LOADED WHILE DETAILS PANE IS CLOSED) */}
      {!showDetailsPane && nodeVersions.length > 0 && activeNode && (
        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black">Histórico de Versões — {activeNode.name}</h4>
            <button
              type="button"
              onClick={() => setShowDetailsPane(true)}
              className="text-[11px] font-bold text-brand-aa hover:underline"
            >
              Fixar no Painel Lateral
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {nodeVersions.map((v) => {
              const verNum = v.versionNumber || v.version_number;
              return (
                <div
                  key={v.id || verNum}
                  className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800"
                >
                  <span>
                    <strong>v{verNum}</strong> • {formatBytes(v.sizeBytes || v.size_bytes)} •{' '}
                    <span className="font-mono text-slate-500">SHA {(v.sha256Hash || v.sha256_hash || '').slice(0, 10)}</span>
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => onRestoreVersion?.(activeNode.id, verNum)}
                      className="px-2.5 py-1 rounded-lg border border-brand/40 text-brand-aa font-bold"
                    >
                      Restaurar v{verNum}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WINDOWS BOTTOM STATUS BAR */}
      <div className="px-3.5 py-2 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">
            {showTrash
              ? `${trashNodes.length} item(ns) na lixeira`
              : `${displayedNodes.length} ${displayedNodes.length === 1 ? 'item' : 'itens'}`}
          </span>
          {!showTrash && selectedNodes.length > 0 && (
            <span className="border-l border-slate-300 dark:border-zinc-700 pl-3 font-semibold text-slate-800 dark:text-zinc-200">
              {selectedNodes.length} selecionado(s)
              {selectedTotalBytes > 0 ? ` (${formatBytes(selectedTotalBytes)})` : ''}
            </span>
          )}
        </div>
        <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400">
          <span>Duplo clique: Abrir</span>
          <span>•</span>
          <span>Botão direito: Menu</span>
          <span>•</span>
          <span>F2: Renomear</span>
          <span>•</span>
          <span>Ctrl+C/X/V: Copiar/Mover</span>
        </div>
      </div>

      {/* FLOATING WINDOWS 11 CONTEXT MENU (RIGHT-CLICK) */}
      {contextMenu && (
        <div
          role="menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-2xl py-1.5 text-xs"
        >
          {contextMenu.node ? (
            (() => {
              const node = contextMenu.node;
              const folder = isFolderNode(node);
              const kind = getFileKind(node);
              const isViewerOnline = node.effectiveAccess === 'viewer_online';
              const lockedBy = getLockedBy(node);
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      handleOpenNode(node);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5 font-bold"
                  >
                    {folder ? <FolderOpen size={14} className="text-amber-500" /> : <Eye size={14} className="text-brand-aa" />}
                    <span>{folder ? 'Abrir pasta' : kind.isSpreadsheet ? 'Abrir no Editor Ao Vivo' : 'Visualizar'}</span>
                  </button>

                  {!folder && !isViewerOnline && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setContextMenu(null);
                        onDownloadNode?.(node);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                    >
                      <Download size={14} />
                      <span>Baixar</span>
                    </button>
                  )}

                  {canWrite && (
                    <>
                      <div className="my-1 border-t border-slate-200 dark:border-zinc-800" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleSetClipboard('cut', [node])}
                        className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2.5">
                          <Scissors size={14} />
                          <span>Recortar</span>
                        </span>
                        <span className="text-[10px] text-slate-400">Ctrl+X</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleSetClipboard('copy', [node])}
                        className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2.5">
                          <Copy size={14} />
                          <span>Copiar</span>
                        </span>
                        <span className="text-[10px] text-slate-400">Ctrl+C</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => startRename(node)}
                        className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2.5">
                          <Pencil size={14} />
                          <span>Renomear</span>
                        </span>
                        <span className="text-[10px] text-slate-400">F2</span>
                      </button>
                    </>
                  )}

                  {!folder && (
                    <>
                      <div className="my-1 border-t border-slate-200 dark:border-zinc-800" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setContextMenu(null);
                          setShowDetailsPane(true);
                          onLoadVersions?.(node);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                      >
                        <History size={14} />
                        <span>Histórico de Versões</span>
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setContextMenu(null);
                            onToggleLock?.(node);
                          }}
                          className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                        >
                          {lockedBy ? <Unlock size={14} /> : <Lock size={14} />}
                          <span>{lockedBy ? 'Desbloquear edição' : 'Bloquear para edição'}</span>
                        </button>
                      )}
                      {canManageAcl && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openShareModal(node)}
                          className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                        >
                          <Link2 size={14} />
                          <span>Gerar Link Temporário</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      setShowDetailsPane(true);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                  >
                    <PanelRight size={14} />
                    <span>Propriedades</span>
                  </button>

                  {canWrite && (
                    <>
                      <div className="my-1 border-t border-slate-200 dark:border-zinc-800" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setContextMenu(null);
                          onDeleteNodes?.([node]);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-between font-semibold"
                      >
                        <span className="flex items-center gap-2.5">
                          <Trash2 size={14} />
                          <span>Excluir</span>
                        </span>
                        <span className="text-[10px]">Del</span>
                      </button>
                    </>
                  )}
                </>
              );
            })()
          ) : (
            /* Empty space context menu */
            <>
              {canWrite && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startCreateFolder}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5 font-semibold"
                  >
                    <FolderPlus size={14} className="text-amber-500" />
                    <span>Nova Pasta</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      fileInputRef.current?.click();
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
                  >
                    <UploadCloud size={14} className="text-brand-aa" />
                    <span>Enviar Arquivos...</span>
                  </button>
                  {clipboard && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handlePaste}
                      className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-between font-semibold text-sky-600 dark:text-sky-400"
                    >
                      <span className="flex items-center gap-2.5">
                        <ClipboardPaste size={14} />
                        <span>Colar aqui</span>
                      </span>
                      <span className="text-[10px]">Ctrl+V</span>
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-200 dark:border-zinc-800" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  setViewMode((m) => (m === 'details' ? 'grid' : 'details'));
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
              >
                {viewMode === 'details' ? <LayoutGrid size={14} /> : <List size={14} />}
                <span>Alternar para {viewMode === 'details' ? 'Ícones Grandes' : 'Detalhes'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  onRefresh?.();
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2.5"
              >
                <RefreshCw size={14} />
                <span>Atualizar</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* REAL FILE PREVIEW MODAL (IMAGE / PDF / TEXT / AUDIO / VIDEO / SPREADSHEET) */}
      {previewInfo && (
        <div
          data-testid="file-preview-modal"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => onClosePreview?.()}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-zinc-900">
              <div className="min-w-0">
                <span className="text-xs font-black text-slate-900 dark:text-white truncate block">
                  Visualização Online — {previewInfo.node.name} ({previewInfo.contentType})
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {formatBytes(previewInfo.node.sizeBytes ?? previewInfo.node.size_bytes)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getFileKind(previewInfo.node).isSpreadsheet && onOpenSheet && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = previewInfo.node;
                      onClosePreview?.();
                      onOpenSheet(target);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <FileSpreadsheet size={13} />
                    <span>Editar Ao Vivo</span>
                  </button>
                )}
                {previewInfo.node.effectiveAccess !== 'viewer_online' && (
                  <button
                    type="button"
                    onClick={() => onDownloadNode?.(previewInfo.node)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center gap-1"
                  >
                    <Download size={13} />
                    <span>Baixar</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onClosePreview?.()}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 text-xs font-bold"
                >
                  Fechar Preview
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-auto bg-slate-100/70 dark:bg-zinc-950 flex items-center justify-center min-h-[280px]">
              {previewInfo.objectUrl && String(previewInfo.contentType || '').startsWith('image/') ? (
                <img
                  src={previewInfo.objectUrl}
                  alt={previewInfo.node.name}
                  className="max-w-full max-h-[70vh] rounded-lg object-contain shadow"
                />
              ) : previewInfo.objectUrl && String(previewInfo.contentType || '').includes('pdf') ? (
                <iframe
                  src={previewInfo.objectUrl}
                  title={previewInfo.node.name}
                  className="w-full h-[70vh] rounded-lg bg-white border border-slate-200 dark:border-zinc-800"
                />
              ) : previewInfo.objectUrl && String(previewInfo.contentType || '').startsWith('video/') ? (
                <video src={previewInfo.objectUrl} controls className="max-w-full max-h-[70vh] rounded-lg" />
              ) : previewInfo.objectUrl && String(previewInfo.contentType || '').startsWith('audio/') ? (
                <audio src={previewInfo.objectUrl} controls className="w-full max-w-md" />
              ) : typeof previewInfo.textContent === 'string' ? (
                <pre className="w-full max-h-[70vh] overflow-auto rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 text-xs font-mono text-slate-800 dark:text-zinc-200 whitespace-pre-wrap">
                  {previewInfo.textContent}
                </pre>
              ) : (
                <div className="text-center space-y-2 py-8">
                  <FileIcon size={36} className="mx-auto text-slate-400" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-zinc-300">
                    Pré-visualização visual não disponível para este formato ({previewInfo.contentType}).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QUICK SHARE LINK MODAL */}
      {shareModalNode && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShareModalNode(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black flex items-center gap-2">
                <Link2 size={16} className="text-brand-aa" />
                <span>Link Temporário Seguro</span>
              </h4>
              <button
                type="button"
                onClick={() => setShareModalNode(null)}
                aria-label="Fechar modal de compartilhamento"
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <X size={15} />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400">
              Arquivo: <strong className="text-slate-900 dark:text-white">{shareModalNode.name}</strong>
            </p>
            <form onSubmit={handleSubmitShareLink} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">Validade do Link</label>
                <select
                  value={shareExpiresHours}
                  onChange={(e) => setShareExpiresHours(Number(e.target.value))}
                  className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 text-xs"
                >
                  <option value={1}>1 hora</option>
                  <option value={24}>24 horas</option>
                  <option value={168}>7 dias</option>
                  <option value={720}>30 dias</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Senha Opcional</label>
                <input
                  type="password"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  placeholder="Deixe vazio para acesso direto pelo link"
                  className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shareAllowDownload}
                  onChange={(e) => setShareAllowDownload(e.target.checked)}
                />
                <span>Permitir download do arquivo pelo link</span>
              </label>
              <button
                type="submit"
                className="w-full min-h-[38px] rounded-xl bg-brand text-brand-fg text-xs font-bold"
              >
                Gerar Link Seguro
              </button>
            </form>
            {createdShareUrl && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-2">
                <p className="text-[11px] font-mono break-all text-emerald-800 dark:text-emerald-200">
                  {createdShareUrl}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigator?.clipboard?.writeText?.(createdShareUrl);
                    toast.success('Link copiado!');
                  }}
                  className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                >
                  Copiar Link
                </button>
              </div>
            )}

            {(() => {
              const activeFileLinks = (shareLinks || []).filter((l) => {
                const sameNode = (l.nodeId || l.node_id) === shareModalNode.id;
                const revoked = Boolean(l.revokedAt || l.revoked_at || l.status === 'revoked');
                const expMs = new Date(l.expiresAt || l.expires_at || 0).getTime();
                const expired = expMs > 0 && expMs <= Date.now();
                return sameNode && !revoked && !expired;
              });
              if (activeFileLinks.length === 0) return null;
              return (
                <div className="pt-3 border-t border-slate-200 dark:border-zinc-800 space-y-2">
                  <p className="text-[11px] font-bold uppercase text-slate-500">
                    Links ativos deste arquivo ({activeFileLinks.length})
                  </p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {activeFileLinks.map((lnk) => (
                      <div
                        key={lnk.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-2.5 py-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-800 dark:text-zinc-200 block truncate">
                            Expira {formatDateTime(lnk.expiresAt || lnk.expires_at)}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {lnk.accessCount ?? lnk.access_count ?? 0} acesso(s) • {lnk.allowDownload || lnk.allow_download ? 'Download' : 'Somente ver'}
                            {lnk.hasPassword ? ' • Com senha' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {lnk.shareUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator?.clipboard?.writeText?.(lnk.shareUrl);
                                toast.success('Link copiado!');
                              }}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-zinc-700 font-bold"
                            >
                              Copiar
                            </button>
                          )}
                          {onRevokeShareLink && (
                            <button
                              type="button"
                              aria-label="Excluir link temporário"
                              onClick={() => onRevokeShareLink(lnk.id, { purge: false })}
                              className="px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1"
                            >
                              <Trash2 size={11} />
                              <span>Excluir</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
