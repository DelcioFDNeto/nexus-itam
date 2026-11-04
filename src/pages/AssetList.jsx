// src/pages/AssetList.jsx
import React, { useState, useEffect, useMemo } from "react";
import { db } from "../services/firebase";
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from "firebase/firestore";
import { getAllAssets, updateAsset } from "../services/assetService";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { safeSpreadsheetCell } from "../utils/sanitize";
import { ASSET_STATUSES, MANUAL_STATUSES, isRetired, lifecycleBlocker } from "../utils/assetStatus";
import { getAssetType } from "../utils/assetTypes";
import { can } from "../utils/permissions";
import { hasFeature } from "../utils/entitlements";
import { buildLabelsDocument, printHtml, resolvePrintBranding } from "../utils/printTemplates";
import { useConfirm } from "../components/ConfirmDialog";
import { isoDay } from "../utils/dates";
import StatusBadge from "../components/StatusBadge";
import AssetListSkeleton from "../components/assets/AssetListSkeleton";
import AssetIcon from "../components/AssetIcon";
import AssetMetrics from "../components/assets/AssetMetrics";
import {
  Search,
  Plus,
  Filter,
  LayoutGrid,
  MapPin,
  User,
  FileText,
  Megaphone,
  Download,
  CheckSquare,
  Square,
  Printer as PrinterIcon,
  RefreshCcw,
  X,
  Check,
  ArrowDownAZ,
  ArrowUpAZ,
  Clock,
  AlertCircle,
  ChevronRight,
  Plug,
  MoreVertical,
  SlidersHorizontal,
  Package,
  Archive,
  FileSignature,
  Truck,
} from "lucide-react";
import TermIssueModal from "../components/terms/TermIssueModal";
import TransferModal from "../components/terms/TransferModal";

const isPromotional = (asset) =>
  asset.category === "Promocional" || asset.internalId?.includes("PRM");

const AssetList = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const [searchParams] = useSearchParams();
  const canWrite = can(currentUser, "assets:write");
  const canImport = can(currentUser, "assets:import") && hasFeature(currentUser, "import");
  const canIssueTerms = can(currentUser, "terms:issue");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  // 'responsabilidade' | 'transferencia' para os itens selecionados
  const [termModal, setTermModal] = useState(null);

  // Estados que controlam a lista de ativos e o carregamento da tela
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({});

  // Definições de filtros de pesquisa e ordenação da tabela (Persistidos na Sessão)
  const [searchTerm, setSearchTerm] = useState(() => sessionStorage.getItem("itam_asset_searchTerm") || "");
  // `?type=` vem dos atalhos do Dashboard e vence o filtro salvo na sessão.
  const [filterType, setFilterType] = useState(
    () => searchParams.get("type") || sessionStorage.getItem("itam_asset_filterType") || "Todos",
  );
  const [filterStatus, setFilterStatus] = useState(() => sessionStorage.getItem("itam_asset_filterStatus") || "Todos");
  const [filterLocation, setFilterLocation] = useState(() => sessionStorage.getItem("itam_asset_filterLocation") || "Todos");
  const [sortOrder, setSortOrder] = useState(() => sessionStorage.getItem("itam_asset_sortOrder") || "asc");
  const [sortBy, setSortBy] = useState(() => sessionStorage.getItem("itam_asset_sortBy") || "internalId");
  const [showRetired, setShowRetired] = useState(false);

  // Estados temporários do Drawer/Bottom Sheet mobile
  const [draftStatus, setDraftStatus] = useState(filterStatus);
  const [draftType, setDraftType] = useState(filterType);
  const [draftLocation, setDraftLocation] = useState(filterLocation);
  const [draftSortBy, setDraftSortBy] = useState(sortBy);
  const [draftSortOrder, setDraftSortOrder] = useState(sortOrder);
  const [draftShowRetired, setDraftShowRetired] = useState(showRetired);

  useEffect(() => {
    sessionStorage.setItem("itam_asset_searchTerm", searchTerm);
    sessionStorage.setItem("itam_asset_filterType", filterType);
    sessionStorage.setItem("itam_asset_filterStatus", filterStatus);
    sessionStorage.setItem("itam_asset_filterLocation", filterLocation);
    sessionStorage.setItem("itam_asset_sortBy", sortBy);
    sessionStorage.setItem("itam_asset_sortOrder", sortOrder);
  }, [searchTerm, filterType, filterStatus, filterLocation, sortBy, sortOrder, showRetired]);

  const uniqueLocations = useMemo(() => {
    const locs = new Set();
    assets.forEach((a) => {
      if (a.location && typeof a.location === "string" && a.location.trim()) {
        locs.add(a.location.trim());
      }
    });
    return Array.from(locs).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [assets]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterStatus !== "Todos") count++;
    if (filterType !== "Todos") count++;
    if (filterLocation !== "Todos") count++;
    if (showRetired) count++;
    return count;
  }, [filterStatus, filterType, filterLocation, showRetired]);

  const handleOpenMobileFilters = () => {
    setDraftStatus(filterStatus);
    setDraftType(filterType);
    setDraftLocation(filterLocation);
    setDraftSortBy(sortBy);
    setDraftSortOrder(sortOrder);
    setDraftShowRetired(showRetired);
    setShowMobileFilters(true);
  };

  // Controle da seleção múltipla para exportação, impressão corporativa e edições conjuntas
  const [selectedIds, setSelectedIds] = useState([]);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => {
    if (!tenantId) {
      setAssets([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    if (currentUser?.authSource === 'gateway') {
      let active = true;
      getAllAssets(tenantId)
        .then((items) => {
          if (active) setAssets(items);
        })
        .catch((error) => {
          console.error("Erro ao sincronizar ativos:", error);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    const q = query(
      collection(db, "assets"),
      where("tenantId", "==", tenantId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const assetData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setAssets(assetData);
        setLoading(false);
      },
      (error) => {
        console.error("Erro ao sincronizar ativos:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [tenantId, currentUser?.authSource]);

  useEffect(() => {
    if (!tenantId) return;
    if (currentUser?.authSource === 'gateway') {
      setConfig({
        companyName: currentUser?.companyName || 'Nexus Indústria & Tecnologia S.A.',
        assetPrefix: currentUser?.assetPrefix || 'NEX',
      });
      return;
    }
    const loadConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "settings", tenantId));
        if (snap.exists()) setConfig(snap.data());
      } catch (err) {
        console.error("Erro ao carregar configurações:", err);
      }
    };

    loadConfig();
  }, [tenantId, currentUser?.authSource, currentUser?.companyName, currentUser?.assetPrefix]);

  // Processa a lista de ativos otimizando filtragem e ordenação dependendo das seleções do menu
  const processedAssets = useMemo(() => {
    const safeLower = (val) => (val || "").toString().toLowerCase();
    const getTimeValue = (value) => {
      if (!value) return 0;
      if (value?.toDate) return value.toDate().getTime();
      if (value?.seconds) return value.seconds * 1000;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    // Filtra logicamente antes de devolver a lista visual de ativos
    let result = assets.filter((asset) => {
      const isPromo = isPromotional(asset);

      // Busca por correspondências em diversos campos textuais do registro
      const term = safeLower(searchTerm);
      const matchesSearch =
        safeLower(asset.model).includes(term) ||
        safeLower(asset.internalId).includes(term) ||
        safeLower(asset.serialNumber).includes(term) ||
        safeLower(asset.assignedTo).includes(term) ||
        safeLower(asset.clientName).includes(term) ||
        safeLower(asset.vendedor).includes(term);

      if (!matchesSearch) return false;

      // Baixados ficam fora da visão padrão: continuam no banco pelo histórico
      // patrimonial, mas não são inventário. Só aparecem quando pedidos.
      if (!showRetired && filterStatus === "Todos" && isRetired(asset.status))
        return false;

      // Limita resultados focando num status específico (Ex: Em Uso, Defeito)
      if (filterStatus !== "Todos" && asset.status !== filterStatus)
        return false;

      // Filtra por localidade específica
      if (filterLocation !== "Todos" && asset.location !== filterLocation)
        return false;

      // Navega rapidamente através das abas horizontais focadas no tipo da máquina
      if (filterType === "Todos") return true;
      if (filterType === "Promocionais") return isPromo;
      if (isPromo) return false;

      if (filterType === "Notebook")
        return (
          asset.type === "Notebook" ||
          safeLower(asset.model).includes("notebook")
        );
      if (filterType === "Computador")
        return (
          asset.type === "Computador" &&
          !safeLower(asset.model).includes("notebook")
        );

      return asset.type === filterType;
    });

    // Ordena os resultados finais por data de registro ou alfabeticamente/numericamente.
    return result.sort((a, b) => {
      if (sortBy === "createdAt") {
        const valA = getTimeValue(a.createdAt);
        const valB = getTimeValue(b.createdAt);
        return sortOrder === "asc" ? valA - valB : valB - valA;
      }

      const valA = safeLower(a[sortBy]);
      const valB = safeLower(b[sortBy]);
      return sortOrder === "asc"
        ? valA.localeCompare(valB, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : valB.localeCompare(valA, undefined, {
            numeric: true,
            sensitivity: "base",
          });
    });
  }, [assets, searchTerm, filterType, filterStatus, filterLocation, sortBy, sortOrder, showRetired]);

  const toggleSelectAll = () => {
    if (selectedIds.length === processedAssets.length) setSelectedIds([]);
    else setSelectedIds(processedAssets.map((a) => a.id));
  };

  const toggleSelectOne = (id) => {
    if (selectedIds.includes(id))
      setSelectedIds((prev) => prev.filter((itemId) => itemId !== id));
    else setSelectedIds((prev) => [...prev, id]);
  };

  const selectedAssetsData = useMemo(() => {
    return assets.filter((a) => selectedIds.includes(a.id));
  }, [assets, selectedIds]);

  const selectedPeripheralsData = useMemo(() => {
    return selectedAssetsData.flatMap((asset) => {
      const peripherals = asset.peripherals || [];
      return peripherals.map((p) => ({
        ...p,
        parentId: asset.internalId,
        parentModel: asset.model,
      }));
    });
  }, [selectedAssetsData]);

  const printBranding = () => resolvePrintBranding(config, currentUser);

  const openPrint = (html) => {
    if (!printHtml(html)) toast.error("Popup bloqueado! Permita popups para imprimir.");
  };

  const handleBulkPrint = () => {
    if (selectedAssetsData.length === 0) return;
    const items = selectedAssetsData.map((asset) => ({ code: asset.internalId, subtitle: asset.model }));
    openPrint(buildLabelsDocument(items, printBranding(), { title: "Etiquetas_Ativos" }));
  };

  const handleBulkPeripheralPrint = () => {
    if (selectedPeripheralsData.length === 0) return;
    const items = selectedPeripheralsData.map((peri) => ({ code: peri.parentId, subtitle: peri.name }));
    openPrint(buildLabelsDocument(items, printBranding(), { variant: "peripheral", title: "Etiquetas_Perifericos" }));
  };

  // Métodos que manipulam a API/banco de dados ou processam a lista num contexto maior
  const handleBulkStatusChange = async (newStatus) => {
    // Em transito so muda pela transferencia; baixado precisa ser reativado.
    const eligible = selectedAssetsData.filter((asset) => !lifecycleBlocker(asset));
    const blocked = selectedAssetsData.length - eligible.length;
    if (eligible.length === 0) {
      toast.error("Nenhum dos ativos selecionados pode mudar de status: estão em trânsito ou baixados.");
      return;
    }
    const ok = await confirm({
      title: "Alteração em Massa",
      message: `Mudar status de ${eligible.length} ativo(s) para "${newStatus}"?${blocked ? ` ${blocked} em trânsito ou baixado(s) ficarão de fora.` : ""}`,
      confirmLabel: "Confirmar Alteração",
    });
    if (!ok) return;
    setBulkProcessing(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    // Sem tenantId o registro na timeline era recusado pelas regras: o status
    // mudava, mas a tela acusava erro e o historico ficava sem a alteracao.
    const results = await Promise.allSettled(
      eligible.map((asset) =>
        updateAsset(
          asset.id,
          { status: newStatus, tenantId: asset.tenantId || tenantId },
          {
            action: "Alteração em Massa",
            details: `Status alterado em lote de "${asset.status || "N/A"}" para "${newStatus}".`,
            user: userEmail,
            tenantId: asset.tenantId || tenantId,
          },
        ),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast.success(`Status de ${results.length} ativos atualizado.`);
      setSelectedIds([]);
      setIsStatusModalOpen(false);
    } else {
      console.error(results.filter((r) => r.status === "rejected").map((r) => r.reason));
      toast.error(`${failed} de ${results.length} ativos não foram atualizados. Verifique suas permissões.`);
    }
    setBulkProcessing(false);
  };

  const handleExportExcel = async () => {
    const XLSX = await import("xlsx");
    // Toda celula passa por safeSpreadsheetCell: um valor como "=cmd|..."
    // digitado no cadastro seria executado pelo Excel ao abrir a planilha.
    const cell = safeSpreadsheetCell;
    const dataToExport = processedAssets.map((asset) => ({
      Patrimônio: cell(asset.internalId),
      Modelo: cell(asset.model),
      Tipo: cell(asset.type),
      Categoria: cell(asset.category || ""),
      Serial: cell(asset.serialNumber || ""),
      Responsável: cell(asset.assignedTo || asset.clientName || ""),
      Setor: cell(asset.sector || ""),
      "Setor/Local": cell(asset.location),
      Status: cell(asset.status),
      Valor: cell(asset.valor || ""),
      "Fim da Garantia": cell(asset.warrantyEnd || ""),
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ativos");
    // Data ISO: "28/09/2026" gerava barras no nome do arquivo.
    XLSX.writeFile(workbook, `Inventario_${tenantId || "Nexus"}_${isoDay()}.xlsx`);
  };

  // Abas de tipo montadas a partir do inventário da própria empresa: cada
  // inquilino vê os tipos que usa (inclusive os personalizados), e não uma
  // lista fixa pensada para a primeira cliente.
  const filters = useMemo(() => {
    const counts = assets.reduce((acc, asset) => {
      if (isPromotional(asset) || isRetired(asset.status)) return acc;
      const type = asset.type || "Outros";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    const byVolume = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => {
        const Icon = getAssetType(type).icon;
        return { label: getAssetType(type).id === type ? getAssetType(type).label : type, value: type, count, icon: <Icon size={16} /> };
      });
    const tabs = [{ label: "Todos", value: "Todos", icon: <LayoutGrid size={16} /> }, ...byVolume];
    if (assets.some(isPromotional)) {
      tabs.push({ label: "Promocionais", value: "Promocionais", icon: <Megaphone size={16} /> });
    }
    // Filtro vindo da URL/sessão que não existe mais na base continua visível.
    if (filterType !== "Todos" && !tabs.some((t) => t.value === filterType)) {
      tabs.push({ label: filterType, value: filterType, count: 0, icon: <LayoutGrid size={16} /> });
    }
    return tabs;
  }, [assets, filterType]);

  // Lista unica de status, vinda do catalogo de ciclo de vida.
  const statusOptions = ASSET_STATUSES.map((st) => st.id);
  // Em massa, só status ativos: baixa exige data e motivo (tela de detalhe).
  const bulkStatusOptions = MANUAL_STATUSES.map((st) => st.id);

  if (loading) return <AssetListSkeleton />;

  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">


      {/* Componente externo contendo o quadro abstrato e quantitativo do ambiente de TI no topo */}
      <AssetMetrics assets={assets} />

      {/* Controles de Busca, Visualização, Botão de Filtro Expandido e Ações Inicias */}
      <div className="px-4 md:px-8 pb-6 bg-slate-50 dark:bg-slate-950 sticky top-0 md:static z-20">
        <div className="bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-xl shadow-sm border border-slate-200/80 dark:border-slate-700 flex flex-col md:flex-row gap-3 md:gap-4 items-stretch md:items-center">
          {/* Campo de pesquisa global com botão de limpar integrado */}
          <div className="flex w-full md:flex-1 gap-2 items-center">
            <div className="relative flex-1">
              <Search
                className="absolute left-3.5 top-3 text-slate-400 dark:text-slate-500"
                size={18}
              />
              <input
                type="text"
                placeholder="Buscar por tag, modelo, serial ou responsável..."
                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-800 focus:border-brand rounded-xl outline-none font-semibold text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-all min-h-[44px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-2.5 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Limpar busca"
                  title="Limpar busca"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Botão de Filtros Mobile (Abre Bottom Sheet Nativo) */}
            <button
              type="button"
              onClick={handleOpenMobileFilters}
              className={`md:hidden relative flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-xl border transition-all ${
                activeFiltersCount > 0
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 shadow-sm"
                  : "bg-slate-50 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              }`}
              title="Filtros avançados"
              aria-label="Filtros avançados"
            >
              <SlidersHorizontal size={18} />
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-mono font-bold text-white shadow-xs">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>

          {/* Contador dinâmico e atalhos rápidos mobile */}
          <div className="flex md:hidden items-center justify-between px-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-slate-900 dark:text-white">{processedAssets.length}</span>
              <span>{processedAssets.length === 1 ? 'ativo encontrado' : 'ativos encontrados'}</span>
            </span>
            <div className="flex items-center gap-2">
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterStatus("Todos");
                    setFilterType("Todos");
                    setFilterLocation("Todos");
                    setShowRetired(false);
                    toast.info("Filtros resetados");
                  }}
                  className="text-[11px] font-bold text-brand hover:underline"
                >
                  Limpar ({activeFiltersCount})
                </button>
              )}
              <button
                type="button"
                onClick={handleExportExcel}
                className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors"
                title="Exportar Excel"
              >
                <Download size={16} />
              </button>
            </div>
          </div>

          {/* Bottom Sheet de Filtros Mobile */}
          {showMobileFilters && (
            <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
              <div
                className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
                onClick={() => setShowMobileFilters(false)}
              />

              <div className="relative bg-white dark:bg-slate-900 rounded-t-2xl border-t border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom duration-300 safe-area-pb">
                <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto -mt-2 mb-2" />

                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <SlidersHorizontal size={18} className="text-brand" />
                      <span>Filtros do Inventário</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Refine a listagem por status, categoria e localidade
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMobileFilters(false)}
                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                    aria-label="Fechar filtros"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4 text-xs">
                  {/* Status */}
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                      Status Operacional
                    </label>
                    <select
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white outline-none focus:border-brand"
                    >
                      <option value="Todos">Todos os Status</option>
                      {statusOptions.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Categoria / Tipo */}
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                      Tipo de Ativo
                    </label>
                    <select
                      value={draftType}
                      onChange={(e) => setDraftType(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white outline-none focus:border-brand"
                    >
                      {filters.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label} {f.count !== undefined ? `(${f.count})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Localização */}
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                      Localização / Setor
                    </label>
                    <select
                      value={draftLocation}
                      onChange={(e) => setDraftLocation(e.target.value)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white outline-none focus:border-brand"
                    >
                      <option value="Todos">Todas as Localizações</option>
                      {uniqueLocations.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Ordenação */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                        Ordenar por
                      </label>
                      <select
                        value={draftSortBy}
                        onChange={(e) => setDraftSortBy(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white outline-none focus:border-brand"
                      >
                        <option value="internalId">Tag Patrimonial</option>
                        <option value="model">Modelo</option>
                        <option value="assignedTo">Responsável</option>
                        <option value="createdAt">Data de Registro</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase text-[10px] tracking-wider">
                        Ordem
                      </label>
                      <button
                        type="button"
                        onClick={() => setDraftSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white flex items-center justify-between"
                      >
                        <span>{draftSortOrder === "asc" ? "Crescente (A-Z)" : "Decrescente (Z-A)"}</span>
                        {draftSortOrder === "asc" ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Incluir Baixados switch/button */}
                  <div className="pt-2">
                    <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <div className="flex items-center gap-2.5">
                        <Archive size={16} className="text-slate-500" />
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white text-xs">Exibir Ativos Baixados</p>
                          <p className="text-[11px] text-slate-400">Inclui itens desativados ou descartados</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draftShowRetired}
                        onChange={(e) => setDraftShowRetired(e.target.checked)}
                        className="w-5 h-5 rounded text-brand focus:ring-brand cursor-pointer"
                      />
                    </label>
                  </div>

                  {/* Ações: Limpar e Aplicar */}
                  <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setDraftStatus("Todos");
                        setDraftType("Todos");
                        setDraftLocation("Todos");
                        setDraftSortBy("internalId");
                        setDraftSortOrder("asc");
                        setDraftShowRetired(false);
                        setFilterStatus("Todos");
                        setFilterType("Todos");
                        setFilterLocation("Todos");
                        setSortBy("internalId");
                        setSortOrder("asc");
                        setShowRetired(false);
                        setShowMobileFilters(false);
                        toast.info("Filtros limpos.");
                      }}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Limpar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFilterStatus(draftStatus);
                        setFilterType(draftType);
                        setFilterLocation(draftLocation);
                        setSortBy(draftSortBy);
                        setSortOrder(draftSortOrder);
                        setShowRetired(draftShowRetired);
                        setShowMobileFilters(false);
                      }}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-xs shadow-md transition-colors"
                    >
                      Aplicar Filtros
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Controles maiores ou que tomam muito espaço sendo mostrados apenas nos computadores */}
          <div className="hidden md:flex gap-2 items-center">
            <div className="flex gap-1 bg-slate-50 dark:bg-slate-900 p-1 rounded-lg border border-slate-200/80 dark:border-slate-800">
              {statusOptions.slice(0, 3).map((st) => (
                <button
                  key={st}
                  onClick={() =>
                    setFilterStatus(filterStatus === st ? "Todos" : st)
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filterStatus === st ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"}`}
                >
                  {st}
                </button>
              ))}
              <div className="w-[1px] h-5 bg-slate-200 dark:bg-slate-800 mx-1 self-center"></div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-600 dark:text-slate-400 outline-none cursor-pointer hover:text-black dark:hover:text-white"
              >
                <option value="Todos">Mais Filtros</option>
                {statusOptions.slice(3).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* Baixados ficam ocultos por padrão; este é o interruptor. */}
            <button
              onClick={() => setShowRetired((v) => !v)}
              title={showRetired ? "Ocultar ativos baixados" : "Incluir ativos baixados"}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                showRetired
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              }`}
            >
              <Archive size={15} />
              <span className="hidden xl:inline">Baixados</span>
            </button>

            <button
              onClick={() =>
                setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              title={sortBy === "createdAt" ? "Alternar recentes/antigos" : "Alternar ordem alfabética"}
              className="p-2 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            >
              {sortOrder === "asc" ? (
                <ArrowDownAZ size={18} />
              ) : (
                <ArrowUpAZ size={18} />
              )}
            </button>
            <button
              onClick={() => {
                const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
                setSortBy(nextSort);
                setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${sortBy === "createdAt" ? "bg-slate-900 text-white border-slate-900 shadow-sm dark:bg-white dark:text-slate-900 dark:border-white" : "bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300"}`}
              title="Ordenar por data e hora de registro"
            >
              <Clock size={16} />
              <span>Recentes</span>
            </button>
          </div>

          {/* Atalhos do painel direito para tarefas mais gerenciais (importar/exportar para Excel) */}
          <div className="hidden md:flex gap-2 border-l border-slate-200/80 dark:border-slate-800 pl-3">
            <button
              onClick={handleExportExcel}
              className="p-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/40 rounded-lg transition-colors border border-emerald-200/60 dark:border-emerald-900/40"
              title="Exportar Excel"
              aria-label="Exportar Excel"
            >
              <Download size={18} />
            </button>
            {canImport && (
              <Link
                to="/import"
                className="p-2 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40 rounded-lg transition-colors border border-blue-200/60 dark:border-blue-900/40"
                title="Importar"
                aria-label="Importar"
              >
                <FileText size={18} />
              </Link>
            )}
          </div>
        </div>

        {/* Rolagem horizontal de abas organizando por Tipo de Ativo */}
        <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
          <button
            onClick={() => {
              const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
              setSortBy(nextSort);
              setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors border ${sortBy === "createdAt" ? "bg-slate-900 text-white border-slate-900 shadow-sm dark:bg-white dark:text-slate-900 dark:border-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
          >
            <Clock size={14} /> Recentes
          </button>
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterType(f.value)}
              aria-pressed={filterType === f.value}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors border ${filterType === f.value ? "bg-slate-900 text-white border-slate-900 shadow-sm dark:bg-white dark:text-slate-900 dark:border-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
            >
              {f.icon} {f.label}
              {f.count !== undefined && (
                <span className="rounded bg-slate-100 px-1 text-[10px] font-mono tabular-nums dark:bg-slate-800 text-slate-600 dark:text-slate-300">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lista real contendo dados extraídos de acordo com o cruzamento de pesquisa, ordenameto e status */}
      <div className="px-4 md:px-8">
        {processedAssets.length === 0 ? (
          <div className="p-20 text-center text-gray-400 dark:text-gray-500 flex flex-col items-center bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-600 border-dashed animate-fade-in">
            <AlertCircle size={48} className="mb-4 opacity-20" />
            <p className="font-medium">
              Nenhum ativo encontrado com esses filtros.
            </p>
          </div>
        ) : (
          <>
            {/* Exibe listagem em cards nativos corporativos de alta fidelidade no mobile */}
            <div className="grid grid-cols-1 gap-3 md:hidden pb-24">
              {processedAssets.map((asset) => {
                const responsible = asset.assignedTo || asset.clientName || null;
                const isOnline = asset.agentOnline || asset.agentStatus === "online" || asset.isOnline;
                const isSelected = selectedIds.includes(asset.id);

                return (
                  <div
                    key={asset.id}
                    onClick={() => navigate(`/assets/${asset.id}`)}
                    className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-150 cursor-pointer active:scale-[0.99] select-none ${
                      isSelected
                        ? "border-brand bg-brand/5 dark:bg-brand/10 dark:border-brand/60 shadow-sm"
                        : "bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 active:bg-slate-50 dark:active:bg-slate-800/80"
                    }`}
                  >
                    {/* Linha 1: Tag Patrimonial em badge mono estilizado, tipo de ativo com ícone, e badge de status corporativo + seleção */}
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 tracking-wider shrink-0">
                          {asset.internalId}
                        </span>
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                          <AssetIcon
                            type={asset.type}
                            category={asset.category}
                            model={asset.model}
                            internalId={asset.internalId}
                            size={13}
                            className="shrink-0"
                          />
                          <span className="truncate">{asset.type || "Equipamento"}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusBadge status={asset.status} size="sm" />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectOne(asset.id);
                          }}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 -mr-1 transition-colors"
                          aria-label={isSelected ? `Desmarcar ${asset.internalId}` : `Selecionar ${asset.internalId}`}
                        >
                          {isSelected ? (
                            <CheckSquare size={19} className="text-brand" />
                          ) : (
                            <Square size={19} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Linha 2: Modelo/Nome do ativo em tipografia expressiva e número de série em monospace discreto */}
                    <div className="mb-2.5">
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-snug tracking-tight line-clamp-1">
                        {asset.model}
                      </h3>
                      {asset.serialNumber && (
                        <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 tracking-tight truncate">
                          S/N: {asset.serialNumber}
                        </p>
                      )}
                    </div>

                    {/* Linha 3: Usuário responsável (com mini avatar) e Localização (com ícone de pino) */}
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 py-1">
                      <div className="flex items-center gap-1.5 min-w-0 max-w-[60%]">
                        <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase shrink-0">
                          {responsible ? responsible.charAt(0) : <User size={10} />}
                        </div>
                        <span className="truncate font-medium text-xs text-slate-700 dark:text-slate-200" title={responsible || "Não atribuído"}>
                          {responsible || "Não atribuído"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 shrink-0 max-w-[40%]" title={asset.location || "Sem local"}>
                        <MapPin size={11} className="text-slate-400 shrink-0" />
                        <span className="truncate">{asset.location || "Sem local"}</span>
                      </div>
                    </div>

                    {/* Linha 4: Metadados táticos (agente online com dot pulsante, data ou garantia) e navegação */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 pt-2 mt-1 border-t border-slate-100 dark:border-slate-800/80">
                      <div className="flex items-center gap-2">
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Agente Online</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Clock size={11} />
                            <span>
                              {asset.warrantyEnd
                                ? `Garantia: ${asset.warrantyEnd}`
                                : asset.createdAt
                                ? `Cadastrado ${new Date(asset.createdAt?.toDate ? asset.createdAt.toDate() : asset.createdAt).toLocaleDateString("pt-BR")}`
                                : "Inventariado"}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-0.5 text-slate-400 group-hover:text-brand transition-colors font-semibold text-[11px]">
                        <span>Detalhes</span>
                        <ChevronRight size={13} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quando no formato para computadores, usa tabelas extensas super rápidas de varrer a visão */}
            <div className="hidden md:block bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200/90 dark:border-slate-800 overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50/90 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-10">
                    <tr className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-semibold tracking-wider">
                      <th className="py-3 px-3 w-12 text-center">
                        <button
                          onClick={toggleSelectAll}
                          className="hover:text-black dark:hover:text-white transition-colors"
                        >
                          {selectedIds.length > 0 &&
                          selectedIds.length === processedAssets.length ? (
                            <CheckSquare size={16} className="text-black dark:text-white" />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-3">Ativo</th>
                      <th className="py-3 px-3">Patrimônio</th>
                      <th className="py-3 px-3">Responsável</th>
                      <th className="py-3 px-3">Local</th>
                      <th className="py-3 px-3 text-center">Status</th>
                      <th className="py-3 px-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {processedAssets.map((asset) => {
                      const responsibleName =
                        asset.assignedTo || asset.clientName || "---";
                      return (
                        <tr
                          key={asset.id}
                          className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer ${selectedIds.includes(asset.id) ? "bg-slate-50 dark:bg-slate-800/50" : ""}`}
                          onClick={() => navigate(`/assets/${asset.id}`)}
                        >
                          <td
                            className="py-2.5 px-3 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => toggleSelectOne(asset.id)}
                              className="text-slate-300 dark:text-slate-600 hover:text-black dark:hover:text-white transition-colors"
                            >
                              {selectedIds.includes(asset.id) ? (
                                <CheckSquare size={16} className="text-black dark:text-white" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0">
                                <AssetIcon
                                  type={asset.type}
                                  category={asset.category}
                                  model={asset.model}
                                  internalId={asset.internalId}
                                  size={16}
                                />
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="font-bold text-gray-900 dark:text-white text-xs xl:text-sm truncate max-w-[120px] xl:max-w-[200px]"
                                  title={asset.model}
                                >
                                  {asset.model}
                                </p>
                                <span className="text-[9px] xl:text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500 mt-1 block truncate">
                                  {asset.type}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="bg-gray-50 dark:bg-slate-900 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 w-fit group-hover:bg-white dark:group-hover:bg-slate-800 transition-colors">
                              <p className="font-mono font-bold text-[10px] xl:text-xs text-gray-900 dark:text-white">
                                {asset.internalId}
                              </p>
                            </div>
                            {asset.serialNumber && (
                              <p className="text-[8px] xl:text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono truncate max-w-[80px] xl:max-w-[100px]" title={asset.serialNumber}>
                                {asset.serialNumber}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              {responsibleName !== "---" && (
                                <div className="hidden xl:flex w-7 h-7 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 items-center justify-center text-[9px] font-black text-gray-600 uppercase border border-white shadow-sm shrink-0">
                                  {responsibleName.substring(0, 2)}
                                </div>
                              )}
                              <p className="text-[11px] xl:text-sm font-bold text-gray-700 dark:text-gray-200 truncate max-w-[100px] xl:max-w-[150px]" title={responsibleName}>
                                {responsibleName}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px] xl:text-sm">
                              <MapPin size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />
                              <span className="truncate max-w-[90px] xl:max-w-[150px] font-medium" title={asset.location || "---"}>
                                {asset.location || "---"}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <StatusBadge status={asset.status} size="sm" />
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="p-1.5 text-gray-300 group-hover:text-black dark:group-hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-all inline-flex">
                              <ChevronRight size={18} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 text-center text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest pb-8">
        Exibindo {processedAssets.length} de {assets.length} ativos
      </div>

      {/* Janela de controle extra que sobe da tela do usuário ao fazer checagem nos itens individualmente */}
      {selectedIds.length > 0 && (
        <div
          className={`fixed bottom-[84px] lg:bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white p-2 pl-4 pr-2 rounded-xl shadow-2xl z-50 flex items-center gap-3 border border-slate-800 w-[calc(100%-1.5rem)] md:w-auto max-w-2xl animate-in fade-in slide-in-from-bottom-4`}
        >
          <div className="flex items-center gap-2.5">
            <div className="bg-brand text-white w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs tabular-nums">
              {selectedIds.length}
            </div>
            <span className="text-xs font-semibold whitespace-nowrap hidden sm:inline text-slate-200">
              Selecionados
            </span>
          </div>
          <div className="h-5 w-[1px] bg-slate-800"></div>
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {canWrite && (
              <button
                onClick={() => setIsStatusModalOpen(true)}
                className="flex items-center gap-1.5 hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-slate-200 hover:text-white"
              >
                <RefreshCcw size={13} /> Status
              </button>
            )}
            <button
              onClick={handleBulkPrint}
              className="flex items-center gap-1.5 hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-slate-200 hover:text-white"
            >
              <PrinterIcon size={13} /> Etiquetas
            </button>
            {canIssueTerms && (
              <>
                <button
                  onClick={() => setTermModal("responsabilidade")}
                  title="Um termo de responsabilidade com todos os itens selecionados"
                  className="flex items-center gap-1.5 hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-slate-200 hover:text-white"
                >
                  <FileSignature size={13} /> Termo
                </button>
                <button
                  onClick={() => setTermModal("transferencia")}
                  title="Enviar os itens selecionados para uma loja"
                  className="flex items-center gap-1.5 hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-slate-200 hover:text-white"
                >
                  <Truck size={13} /> Transferir
                </button>
              </>
            )}
            {selectedPeripheralsData.length > 0 && (
              <button
                onClick={handleBulkPeripheralPrint}
                className="flex items-center gap-1.5 hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-slate-200 hover:text-white"
              >
                <Plug size={13} /> Acessórios
              </button>
            )}
          </div>
          <button
            onClick={() => setSelectedIds([])}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors ml-auto text-slate-400 hover:text-white"
            title="Limpar seleção"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Opção para forçar alteração simultânea nos atributos dos componentes de um mesmo modelo (Ex: Retornar para Status Disponível um lote de Notebooks) */}
      {termModal === "responsabilidade" && (
        <TermIssueModal
          kind="responsabilidade"
          initialAssets={selectedAssetsData}
          onClose={() => setTermModal(null)}
          onIssued={() => setSelectedIds([])}
        />
      )}
      {termModal === "transferencia" && (
        <TransferModal
          initialAssets={selectedAssetsData}
          onClose={() => setTermModal(null)}
          onDispatched={() => setSelectedIds([])}
        />
      )}

      {isStatusModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-2">
            <div className="bg-gray-50 dark:bg-slate-900 p-5 rounded-[1.5rem] mb-2 flex justify-between items-center">
              <h3 className="font-black text-lg flex items-center gap-2">
                <RefreshCcw size={20} className="text-black dark:text-white" /> Novo Status
              </h3>
              <button
                onClick={() => setIsStatusModalOpen(false)}
                className="hover:bg-gray-200 dark:hover:bg-slate-700 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 font-medium px-2">
                Alterar status de <strong>{selectedIds.length}</strong> itens
                selecionados:
              </p>
              <div className="space-y-2">
                {bulkStatusOptions.map((status) => (
                  <button
                    key={status}
                    onClick={() => handleBulkStatusChange(status)}
                    disabled={bulkProcessing}
                    className="w-full py-2.5 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors font-semibold text-xs text-left flex items-center justify-between group shadow-sm disabled:opacity-50"
                  >
                    {status}{" "}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-brand">
                      <Check size={14} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetList;
