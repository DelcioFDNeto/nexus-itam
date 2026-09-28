// src/pages/AssetList.jsx
import React, { useState, useEffect, useMemo } from "react";
import { db } from "../services/firebase";
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from "firebase/firestore";
import { updateAsset } from "../services/assetService";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { safeSpreadsheetCell } from "../utils/sanitize";
import { ACTIVE_STATUSES, ASSET_STATUSES, isRetired } from "../utils/assetStatus";
import { getAssetType } from "../utils/assetTypes";
import { can } from "../utils/permissions";
import { hasFeature } from "../utils/entitlements";
import { buildLabelsDocument, printHtml, resolvePrintBranding } from "../utils/printTemplates";
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
} from "lucide-react";

const isPromotional = (asset) =>
  asset.category === "Promocional" || asset.internalId?.includes("PRM");

const AssetList = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [searchParams] = useSearchParams();
  const canWrite = can(currentUser, "assets:write");
  const canImport = can(currentUser, "assets:import") && hasFeature(currentUser, "import");

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
  const [sortOrder, setSortOrder] = useState(() => sessionStorage.getItem("itam_asset_sortOrder") || "asc");
  const [sortBy, setSortBy] = useState(() => sessionStorage.getItem("itam_asset_sortBy") || "internalId");
  const [showRetired, setShowRetired] = useState(false);

  useEffect(() => {
    sessionStorage.setItem("itam_asset_searchTerm", searchTerm);
    sessionStorage.setItem("itam_asset_filterType", filterType);
    sessionStorage.setItem("itam_asset_filterStatus", filterStatus);
    sessionStorage.setItem("itam_asset_sortBy", sortBy);
    sessionStorage.setItem("itam_asset_sortOrder", sortOrder);
  }, [searchTerm, filterType, filterStatus, sortBy, sortOrder, showRetired]);

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
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const loadConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "settings", tenantId));
        if (snap.exists()) setConfig(snap.data());
      } catch (err) {
        console.error("Erro ao carregar configurações:", err);
      }
    };

    loadConfig();
  }, [tenantId]);

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
  }, [assets, searchTerm, filterType, filterStatus, sortBy, sortOrder, showRetired]);

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
    if (!confirm(`Mudar status de ${selectedIds.length} ativos para "${newStatus}"?`)) return;
    setBulkProcessing(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    // Sem tenantId o registro na timeline era recusado pelas regras: o status
    // mudava, mas a tela acusava erro e o historico ficava sem a alteracao.
    const results = await Promise.allSettled(
      selectedAssetsData.map((asset) =>
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
    XLSX.writeFile(workbook, `Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  const bulkStatusOptions = ACTIVE_STATUSES.map((st) => st.id);

  if (loading) return <AssetListSkeleton />;

  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">


      {/* Componente externo contendo o quadro abstrato e quantitativo do ambiente de TI no topo */}
      <AssetMetrics assets={assets} />

      {/* Controles de Busca, Visualização, Botão de Filtro Expandido e Ações Inicias */}
      <div className="px-4 md:px-8 pb-6 bg-slate-50 dark:bg-slate-950 sticky top-0 md:static z-20">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl shadow-sm border border-gray-100 dark:border-slate-700 flex flex-col md:flex-row gap-4 items-center">
          {/* Campo de pesquisa global que abrange IDs e Nomes */}
          <div className="relative w-full md:flex-1">
            <Search
              className="absolute left-4 top-3.5 text-gray-400 dark:text-gray-500"
              size={20}
            />
            <input
              type="text"
              placeholder="Buscar por tag, modelo, serial ou responsável..."
              className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-slate-900 border-transparent focus:bg-white dark:focus:bg-slate-800 border-2 focus:border-brand rounded-2xl outline-none font-bold text-sm text-gray-800 dark:text-gray-100 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Controles maiores ou que tomam muito espaço sendo mostrados apenas nos computadores */}
          <div className="hidden md:flex gap-2 items-center">
            <div className="flex gap-1 bg-gray-50 dark:bg-slate-900 p-1.5 rounded-2xl border border-gray-100 dark:border-slate-700">
              {statusOptions.slice(0, 3).map((st) => (
                <button
                  key={st}
                  onClick={() =>
                    setFilterStatus(filterStatus === st ? "Todos" : st)
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filterStatus === st ? "bg-black text-white shadow-md dark:bg-white dark:text-slate-900" : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700"}`}
                >
                  {st}
                </button>
              ))}
              <div className="w-[1px] h-6 bg-gray-200 mx-1 self-center"></div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs font-bold text-gray-500 dark:text-gray-400 outline-none cursor-pointer hover:text-black dark:hover:text-white"
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
              className={`flex items-center gap-1.5 rounded-2xl border px-3 py-3 text-xs font-bold transition-colors ${
                showRetired
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-500 dark:text-gray-400 hover:bg-gray-100"
              }`}
            >
              <Archive size={16} />
              <span className="hidden xl:inline">Baixados</span>
            </button>

            <button
              onClick={() =>
                setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              title={sortBy === "createdAt" ? "Alternar recentes/antigos" : "Alternar ordem alfabética"}
              className="p-3 bg-gray-50 dark:bg-slate-900 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-2xl border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-gray-300 transition-colors"
            >
              {sortOrder === "asc" ? (
                <ArrowDownAZ size={20} />
              ) : (
                <ArrowUpAZ size={20} />
              )}
            </button>
            <button
              onClick={() => {
                const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
                setSortBy(nextSort);
                setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
              }}
              className={`flex items-center gap-2 px-3 py-3 rounded-2xl border text-xs font-black transition-colors ${sortBy === "createdAt" ? "bg-black text-white border-black shadow-md" : "bg-gray-50 dark:bg-slate-900 hover:bg-gray-100 border-gray-100 dark:border-slate-700 text-gray-600"}`}
              title="Ordenar por data e hora de registro"
            >
              <Clock size={18} />
              <span>Recentes</span>
            </button>
          </div>

          {/* Atalhos do painel direito para tarefas mais gerenciais (importar/exportar para Excel) */}
          <div className="hidden md:flex gap-2 border-l border-gray-100 dark:border-slate-700 pl-4">
            <button
              onClick={handleExportExcel}
              className="p-3 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-900/40 rounded-2xl transition-colors"
              title="Exportar Excel"
              aria-label="Exportar Excel"
            >
              <Download size={20} />
            </button>
            {canImport && (
              <Link
                to="/import"
                className="p-3 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40 rounded-2xl transition-colors"
                title="Importar"
                aria-label="Importar"
              >
                <FileText size={20} />
              </Link>
            )}
          </div>
        </div>

        {/* Rolagem horizontal de abas arredondadas e rápidas organizando por Tipo de Ativo */}
        <div className="flex gap-3 overflow-x-auto py-4 scrollbar-hide">
          <button
            onClick={() => {
              const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
              setSortBy(nextSort);
              setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${sortBy === "createdAt" ? "bg-black text-white border-black shadow-lg scale-105 dark:bg-white dark:text-slate-900 dark:border-white" : "bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-slate-600 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700"}`}
          >
            <Clock size={16} /> Recentes
          </button>
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterType(f.value)}
              aria-pressed={filterType === f.value}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${filterType === f.value ? "bg-black text-white border-black shadow-lg scale-105 dark:bg-white dark:text-slate-900 dark:border-white" : "bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-slate-600 hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700"}`}
            >
              {f.icon} {f.label}
              {f.count !== undefined && (
                <span className="rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums dark:bg-white/10">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lista real contendo dados extraídos de acordo com o cruzamento de pesquisa, ordenameto e status */}
      <div className="px-4 md:px-8">
        {processedAssets.length === 0 ? (
          <div className="p-20 text-center text-gray-400 dark:text-gray-500 flex flex-col items-center bg-white dark:bg-slate-800 rounded-3xl border border-gray-200 dark:border-slate-600 border-dashed animate-fade-in">
            <AlertCircle size={48} className="mb-4 opacity-20" />
            <p className="font-medium">
              Nenhum ativo encontrado com esses filtros.
            </p>
          </div>
        ) : (
          <>
            {/* Exibe listagem agrupada em cards com menos detalhes quando no celular por falta de tela */}
            <div className="grid grid-cols-1 gap-4 md:hidden pb-20">
              {processedAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => navigate(`/assets/${asset.id}`)}
                  className={`p-5 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-[0_4px_20px_-12px_rgba(0,0,0,0.1)] active:scale-[0.98] transition-all relative overflow-hidden group ${selectedIds.includes(asset.id) ? "ring-2 ring-black bg-gray-50 dark:bg-slate-900" : "bg-white dark:bg-slate-800"}`}
                >
                  {/* Forma orgânica desenhada apenas para visual agradável das extremidades do Card */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 dark:bg-slate-900 rounded-full -mr-10 -mt-10 opacity-50 pointer-events-none"></div>

                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <StatusBadge status={asset.status} size="sm" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectOne(asset.id);
                      }}
                      className="text-gray-300 active:scale-125 transition-transform p-1"
                    >
                      {selectedIds.includes(asset.id) ? (
                        <CheckSquare size={24} className="text-black dark:text-white" />
                      ) : (
                        <Square size={24} />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-5 relative z-10">
                    <div className="w-16 h-16 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 dark:text-gray-200 shrink-0">
                      <AssetIcon
                        type={asset.type}
                        category={asset.category}
                        model={asset.model}
                        internalId={asset.internalId}
                        size={32}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-gray-900 dark:text-white leading-tight truncate text-lg">
                        {asset.model}
                      </h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono font-bold mt-1 tracking-wider">
                        {asset.internalId}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400 relative z-10">
                    <div className="flex items-center gap-2 truncate max-w-[60%]">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <User size={12} />
                      </div>
                      <span className="truncate">
                        {asset.assignedTo || asset.clientName || "N/A"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-75">
                      <MapPin size={12} />{" "}
                      {asset.location?.substring(0, 10) || "N/A"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quando no formato para computadores, usa tabelas extensas super rápidas de varrer a visão */}
            <div className="hidden md:block bg-white dark:bg-slate-800 rounded-[2rem] shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 sticky top-0 z-10 backdrop-blur-sm">
                    <tr className="text-[10px] xl:text-xs uppercase text-gray-400 dark:text-gray-500 font-black tracking-widest">
                      <th className="py-4 px-3 w-12 text-center">
                        <button
                          onClick={toggleSelectAll}
                          className="hover:text-black dark:hover:text-white transition-colors"
                        >
                          {selectedIds.length > 0 &&
                          selectedIds.length === processedAssets.length ? (
                            <CheckSquare size={18} className="text-black dark:text-white" />
                          ) : (
                            <Square size={18} />
                          )}
                        </button>
                      </th>
                      <th className="py-4 px-3">Ativo</th>
                      <th className="py-4 px-3">Patrimônio</th>
                      <th className="py-4 px-3">Responsável</th>
                      <th className="py-4 px-3">Local</th>
                      <th className="py-4 px-3 text-center">Status</th>
                      <th className="py-4 px-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/60">
                    {processedAssets.map((asset) => {
                      const responsibleName =
                        asset.assignedTo || asset.clientName || "---";
                      return (
                        <tr
                          key={asset.id}
                          className={`hover:bg-gray-50/80 dark:hover:bg-slate-700/40 transition-all group cursor-pointer ${selectedIds.includes(asset.id) ? "bg-gray-50 dark:bg-slate-900" : ""}`}
                          onClick={() => navigate(`/assets/${asset.id}`)}
                        >
                          <td
                            className="py-3 px-3 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => toggleSelectOne(asset.id)}
                              className="text-gray-300 dark:text-gray-500 hover:text-black dark:hover:text-white transition-colors"
                            >
                              {selectedIds.includes(asset.id) ? (
                                <CheckSquare size={18} className="text-black dark:text-white" />
                              ) : (
                                <Square size={18} />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl flex items-center justify-center shadow-sm text-gray-600 group-hover:scale-110 transition-transform shrink-0">
                                <AssetIcon
                                  type={asset.type}
                                  category={asset.category}
                                  model={asset.model}
                                  internalId={asset.internalId}
                                  size={18}
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
          className={`fixed bottom-[90px] lg:bottom-8 left-1/2 -translate-x-1/2 bg-[#18181B] text-white p-2 pl-6 pr-2 rounded-full shadow-2xl z-50 flex items-center gap-6 animate-in slide-in-from-bottom-10 border border-white/10 w-[90%] md:w-auto max-w-2xl`}
        >
          <div className="flex items-center gap-3">
            <div className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center font-black text-xs">
              {selectedIds.length}
            </div>
            <span className="text-sm font-bold whitespace-nowrap hidden sm:inline">
              Selecionados
            </span>
          </div>
          <div className="h-6 w-[1px] bg-white/20"></div>
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {canWrite && (
              <button
                onClick={() => setIsStatusModalOpen(true)}
                className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
              >
                <RefreshCcw size={14} /> Status
              </button>
            )}
            <button
              onClick={handleBulkPrint}
              className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
            >
              <PrinterIcon size={14} /> Etiquetas
            </button>
            {selectedPeripheralsData.length > 0 && (
              <button
                onClick={handleBulkPeripheralPrint}
                className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
              >
                <Plug size={14} /> Acessórios
              </button>
            )}
          </div>
          <button
            onClick={() => setSelectedIds([])}
            className="p-2 hover:bg-red-600 rounded-full transition-colors ml-auto"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Opção para forçar alteração simultânea nos atributos dos componentes de um mesmo modelo (Ex: Retornar para Status Disponível um lote de Notebooks) */}
      {isStatusModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-2">
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
                    className="w-full py-3 px-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-black hover:text-white hover:border-black transition-all font-bold text-sm text-left flex items-center justify-between group active:scale-95 shadow-sm"
                  >
                    {status}{" "}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Check size={16} />
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
