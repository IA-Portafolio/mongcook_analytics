import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LabelList
} from 'recharts';
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  ShoppingBag,
  ArrowUpRight,
  Filter,
  Crown,
  Medal,
  Upload,
  Database,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  DollarSign,
  Package,
  Menu,
  X,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { KpiSummary, ComparativeData, ChannelData, FilterState } from './types';
import { buildDefaultFilterState } from './lib/dashboard-range';
import { formatCurrency, formatPercent, cn, safeDivide } from './lib/utils';

const CHANNEL_COLORS: Record<string, string> = {
  'Punto de Venta': '#272121',
  'Delivery Propio': '#ff0024',
  'Rappi': '#1e3a5f',
};

// Platform commissions per channel (percentage of sales)
const CHANNEL_COMMISSION: Record<string, number> = {
  'Rappi': 0.10, // 10% commission
};

// Format large numbers as compact (e.g. $1.2M)
function formatCompact(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return formatCurrency(value);
}

// ── Toast System ─────────────────────────────────────────────────────

interface ToastData {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const show = useCallback((message: string, type: ToastData['type'] = 'success') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  return { toasts, show };
}

function ToastContainer({ toasts }: { toasts: ToastData[] }) {
  return (
    <div className="fixed top-6 right-6 z-[100] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 80, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.95 }}
            className={cn(
              "flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg backdrop-blur-md border text-sm font-medium",
              toast.type === 'success' && "bg-emerald-50/90 border-emerald-200 text-emerald-800",
              toast.type === 'error' && "bg-red-50/90 border-red-200 text-red-800",
              toast.type === 'info' && "bg-white/90 border-[#272121]/10 text-[#272121]",
            )}
          >
            {toast.type === 'success' && <CheckCircle size={16} />}
            {toast.type === 'error' && <AlertCircle size={16} />}
            {toast.type === 'info' && <RefreshCw size={16} />}
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────

export default function App() {
  const defaultFilters = buildDefaultFilterState();
  const [activeTab, setActiveTab] = useState<'summary' | 'comparative1' | 'comparative2' | 'byProduct'>('summary');
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [compData, setCompData] = useState<ComparativeData[]>([]);
  const [channelData, setChannelData] = useState<ChannelData[]>([]);
  const [productData, setProductData] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('sidebarCollapsed') === '1';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    }
  }, [sidebarCollapsed]);
  const [filters, setFilters] = useState<FilterState>(() => buildDefaultFilterState());
  const { toasts, show: showToast } = useToast();
  const hasData = summary && (summary.totalSales || summary.totalQuantity);
  const availableFamilies = [...new Set([...compData.map(d => d.family), ...channelData.map(d => d.family)])].sort();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.families.length > 0) params.set('families', filters.families.join(','));
      const qs = params.toString() ? `?${params.toString()}` : '';

      const [sumRes, compRes, chanRes, prodRes] = await Promise.all([
        fetch(`/api/metrics/summary${qs}`),
        fetch(`/api/metrics/comparative-type${qs}`),
        fetch(`/api/metrics/comparative-channel${qs}`),
        fetch(`/api/metrics/by-product${qs}`),
      ]);

      const sum = await sumRes.json();
      const comp = await compRes.json();
      const chan = await chanRes.json();
      const prod = await prodRes.json();

      setSummary(sum);
      setCompData(comp);
      setChannelData(chan);
      setProductData(prod);
    } catch (error) {
      console.error("Error fetching data:", error);
      showToast("Error al cargar datos", "error");
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [fetchData]);

  const seedData = async () => {
    try {
      const res = await fetch('/api/data/seed', { method: 'POST' });
      const data = await res.json();
      showToast(`Datos sembrados correctamente (${data.rows} filas)`, 'success');
      fetchData();
    } catch {
      showToast("Error al sembrar datos", "error");
    }
  };

  const toggleFamily = (family: string) => {
    setFilters(prev => ({
      ...prev,
      families: prev.families.includes(family)
        ? prev.families.filter(f => f !== family)
        : [...prev.families, family],
    }));
  };

  const activeFiltersCount =
    (filters.startDate && filters.startDate !== defaultFilters.startDate ? 1 : 0) +
    (filters.endDate && filters.endDate !== defaultFilters.endDate ? 1 : 0) +
    filters.families.length;

  const sidebarContent = (
    <>
      <div className="p-8">
        <h1 className="text-2xl font-black tracking-tight">Mongcook</h1>
        <p className="text-[11px] uppercase tracking-widest opacity-50 mt-1">Analytics Dashboard</p>
      </div>

      <nav className="mt-4 px-4 space-y-1">
        <NavItem
          icon={<LayoutDashboard size={18} />}
          label="Resumen Ejecutivo"
          active={activeTab === 'summary'}
          onClick={() => { setActiveTab('summary'); setMobileMenuOpen(false); }}
        />
        <NavItem
          icon={<Users size={18} />}
          label="Personal vs Compartir"
          active={activeTab === 'comparative1'}
          onClick={() => { setActiveTab('comparative1'); setMobileMenuOpen(false); }}
        />
        <NavItem
          icon={<ShoppingBag size={18} />}
          label="Canales de Venta"
          active={activeTab === 'comparative2'}
          onClick={() => { setActiveTab('comparative2'); setMobileMenuOpen(false); }}
        />
        <NavItem
          icon={<Package size={18} />}
          label="Productos por Familia"
          active={activeTab === 'byProduct'}
          onClick={() => { setActiveTab('byProduct'); setMobileMenuOpen(false); }}
        />
      </nav>

      {/* Sidebar footer with status */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", hasData ? "bg-emerald-400" : "bg-[#fcec0e]")} />
          <span className="text-[11px] opacity-50">
            {hasData ? "Datos cargados" : "Sin datos"}
          </span>
        </div>
        <img src="/ia-portafolio-logotype.png" alt="IA Portafolio" className="h-5 opacity-40" />
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#e8e7e5] text-[#272121] font-sans selection:bg-[#ff0024] selection:text-white">
      <ToastContainer toasts={toasts} />

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#272121] text-[#d1d0d1] backdrop-blur-md border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-black tracking-tight">Mongcook</h1>
        <button
          onClick={() => setMobileMenuOpen(prev => !prev)}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/30 z-50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="md:hidden fixed left-0 top-0 h-full w-72 bg-[#272121] text-[#d1d0d1] z-[60] shadow-2xl"
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full border-r border-[#272121]/15 bg-[#272121] text-[#d1d0d1] z-50 hidden md:block transition-all duration-300 ease-in-out overflow-hidden",
          sidebarCollapsed ? "w-0 border-r-0" : "w-64"
        )}
      >
        <div className="w-64 h-full">{sidebarContent}</div>
      </aside>

      {/* Desktop Sidebar Toggle */}
      <button
        onClick={() => setSidebarCollapsed(prev => !prev)}
        aria-label={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
        title={sidebarCollapsed ? "Mostrar menú" : "Ocultar menú"}
        className={cn(
          "hidden md:flex fixed top-4 z-[55] h-9 w-9 items-center justify-center rounded-full bg-[#272121] text-[#d1d0d1] shadow-lg hover:bg-[#ff0024] transition-all duration-300",
          sidebarCollapsed ? "left-4" : "left-[17rem]"
        )}
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* Main Content */}
      <main
        className={cn(
          "p-6 md:p-8 pt-20 md:pt-8 transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "md:ml-0 md:pl-16" : "md:ml-64"
        )}
      >
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {activeTab === 'summary' && "Resumen Ejecutivo"}
              {activeTab === 'comparative1' && "Personales vs Para Compartir"}
              {activeTab === 'comparative2' && "Análisis por Canal"}
              {activeTab === 'byProduct' && "Análisis por Producto"}
            </h2>
            <p className="text-sm opacity-60 mt-2">Monitoreo de desempeño del restaurante</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFilters(prev => !prev)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 border border-[#272121] rounded-full text-xs font-mono uppercase tracking-wider transition-colors relative",
                showFilters ? "bg-[#272121] text-[#d1d0d1]" : "hover:bg-[#272121] hover:text-[#d1d0d1]"
              )}
            >
              <Filter size={14} />
              Filtros
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#ff0024] text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-[#272121] text-[#d1d0d1] rounded-full text-xs font-mono uppercase tracking-wider hover:bg-[#ff0024] transition-colors">
              <Upload size={14} />
              <span className="hidden sm:inline">Exportar PDF</span>
            </button>
          </div>
        </header>

        {/* Filter Bar */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden mb-8"
            >
              <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-5 md:p-6 backdrop-blur-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-6">
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold whitespace-nowrap">Desde</label>
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                      className="bg-transparent border border-[#272121]/20 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#ff0024] transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold whitespace-nowrap">Hasta</label>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                      className="bg-transparent border border-[#272121]/20 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#ff0024] transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold mr-1">Familias</span>
                    <div className="relative">
                      <select
                        value=""
                        onChange={e => {
                          if (e.target.value && !filters.families.includes(e.target.value)) {
                            setFilters(prev => ({ ...prev, families: [...prev.families, e.target.value] }));
                          }
                          e.target.value = '';
                        }}
                        className="bg-transparent border border-[#272121]/20 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-[#ff0024] transition-colors appearance-none pr-7 cursor-pointer"
                      >
                        <option value="">{filters.families.length === 0 ? 'Ver todo' : 'Agregar familia...'}</option>
                        {availableFamilies.filter(f => !filters.families.includes(f)).map(family => (
                          <option key={family} value={family}>{family}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
                    </div>
                    {filters.families.map(family => (
                      <button
                        key={family}
                        onClick={() => setFilters(prev => ({ ...prev, families: prev.families.filter(f => f !== family) }))}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono bg-[#272121] text-[#d1d0d1] border border-[#272121] shadow-md transition-all hover:bg-[#ff0024] hover:border-[#ff0024]"
                      >
                        {family}
                        <X size={12} className="opacity-70" />
                      </button>
                    ))}
                  </div>
                  {activeFiltersCount > 0 && (
                    <button
                      onClick={() => setFilters(buildDefaultFilterState())}
                      className="text-xs font-mono text-[#ff0024] hover:underline whitespace-nowrap"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#272121]/20 border-t-[#ff0024]"></div>
            <p className="text-sm font-mono opacity-40">Cargando datos...</p>
          </div>
        ) : !hasData ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-[60vh] gap-6 text-center"
          >
            <div className="p-6 bg-white/50 rounded-3xl border border-[#272121]/10">
              <Database size={48} className="opacity-20" />
            </div>
            <div>
              <h3 className="font-bold text-2xl mb-2">Sin datos disponibles</h3>
              <p className="text-sm opacity-50 max-w-sm">
                No hay datos disponibles para mostrar.
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {activeTab === 'summary' && <SummaryView summary={summary} compData={compData} channelData={channelData} productData={productData} />}
            {activeTab === 'comparative1' && <ComparativeTypeView data={compData} />}
            {activeTab === 'comparative2' && <ChannelView data={channelData} />}
            {activeTab === 'byProduct' && <ProductView data={productData} />}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#272121]/10 bg-[#272121] py-6 mt-12">
        <div className="flex items-center justify-center gap-2 text-sm text-white/60">
          <span>Hecho con</span>
          <span className="text-red-500">❤️</span>
          <span>por</span>
          <img src="/ia-portafolio-logo.png" alt="IA Portafolio" className="h-6 inline-block opacity-80" />
        </div>
      </footer>
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────────────

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200",
        active
          ? "bg-[#ff0024] text-white shadow-lg shadow-red-900/20"
          : "hover:bg-white/10 opacity-70 hover:opacity-100"
      )}
    >
      {icon}
      <span className="font-medium flex-1 text-left">{label}</span>
      {active && <motion.div layoutId="active-pill"><ChevronRight size={14} /></motion.div>}
    </button>
  );
}

function KpiCard({ title, value, icon, subtitle }: { title: string, value: string, icon: React.ReactNode, subtitle?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/50 border border-[#272121]/10 rounded-2xl p-5 md:p-6 backdrop-blur-sm hover:border-[#272121]/30 transition-all group"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-[#ff0024] text-white rounded-lg group-hover:bg-[#272121] transition-colors">
          {icon}
        </div>
      </div>
      <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono mb-1">{title}</p>
      <h4 className="text-2xl font-bold tracking-tighter">{value}</h4>
      {subtitle && <p className="text-[11px] font-mono opacity-40 mt-1">{subtitle}</p>}
    </motion.div>
  );
}

// Shared chart tooltip style
const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,0.95)',
  border: '1px solid rgba(39,33,33,0.1)',
  borderRadius: '12px',
  color: '#272121',
  fontSize: '12px',
  padding: '10px 14px',
  boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
};

// ── SummaryView ──────────────────────────────────────────────────────

function SummaryView({ summary, compData, channelData, productData }: { summary: KpiSummary | null, compData: ComparativeData[], channelData: ChannelData[], productData: ProductRow[] }) {
  if (!summary) return null;

  const totalSales = summary.totalSales || 0;
  const totalTax = summary.totalTax || 0;
  const totalDiscount = Math.abs(summary.totalDiscount || 0);
  const ventaNeta = totalSales - totalDiscount - totalTax;
  const marginPct = safeDivide(summary.totalMargin || 0, ventaNeta);

  const familyChartData = Object.values(
    compData.reduce((acc, d) => {
      if (!acc[d.family]) acc[d.family] = { family: d.family, sales: 0, quantity: 0 };
      acc[d.family].sales += d.sales;
      acc[d.family].quantity += d.quantity;
      return acc;
    }, {} as Record<string, { family: string; sales: number; quantity: number }>)
  ).sort((a, b) => a.sales - b.sales);
  const totalFamilySales = familyChartData.reduce((a, d) => a + d.sales, 0);

  return (
    <div className="space-y-8">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Ingresos Totales" value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} />
        <KpiCard title="Número de Órdenes" value={(summary.totalOrders ?? 0).toString()} icon={<Package size={20} />} subtitle="órdenes" />
        <KpiCard title="Costo de Ventas" value={formatCurrency(summary.totalCost || 0)} icon={<TrendingUp size={20} />} />
        <KpiCard title="Margen Neto" value={formatCurrency(summary.totalMargin || 0)} icon={<TrendingUp size={20} />} subtitle={formatPercent(marginPct)} />
        <KpiCard title="Descuentos" value={formatCurrency(totalDiscount)} icon={<Tag size={20} />} subtitle={formatPercent(safeDivide(totalDiscount, totalSales))} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Distribución por Familia</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={familyChartData} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#272121" strokeOpacity={0.05} />
                <XAxis dataKey="family" axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.6 }} />
                <YAxis axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.4 }} tickFormatter={v => formatCompact(v)} />
                <Tooltip
                  cursor={{ fill: '#272121', opacity: 0.05 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { family: string; sales: number; quantity: number };
                    return (
                      <div style={tooltipStyle}>
                        <p className="font-bold text-sm mb-2">{d.family}</p>
                        <div className="space-y-1 text-xs">
                          <p className="flex justify-between gap-4">
                            <span className="opacity-60">Ventas</span>
                            <span className="font-mono font-bold">{formatCurrency(d.sales)}</span>
                          </p>
                          <p className="flex justify-between gap-4">
                            <span className="opacity-60">Cantidad</span>
                            <span className="font-mono font-bold">{d.quantity.toLocaleString('es-CL')} uds</span>
                          </p>
                          <p className="flex justify-between gap-4">
                            <span className="opacity-60">Participación</span>
                            <span className="font-mono font-bold">{formatPercent(safeDivide(d.sales, totalFamilySales))}</span>
                          </p>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="sales" fill="#272121" radius={[6, 6, 0, 0]}>
                  <LabelList
                    content={(props: any) => {
                      const { x, y, width, value, index } = props;
                      const item = familyChartData[index];
                      if (!item) return null;
                      return (
                        <g>
                          <text x={x + width / 2} y={y - 18} textAnchor="middle" fontSize={10} fill="#272121" opacity={0.55} fontWeight="600">
                            {formatCompact(value)}
                          </text>
                          <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={9} fill="#272121" opacity={0.38}>
                            {formatPercent(safeDivide(item.sales, totalFamilySales))}
                          </text>
                        </g>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Personal vs Compartir</h3>
          {(() => {
            const personalSales = compData.filter(d => d.is_personal === 1).reduce((acc, curr) => acc + curr.sales, 0);
            const compartirSales = compData.filter(d => d.is_personal === 0).reduce((acc, curr) => acc + curr.sales, 0);
            const otrosSales = compData.filter(d => d.is_personal === -1).reduce((acc, curr) => acc + curr.sales, 0);
            const total = personalSales + compartirSales + otrosSales;
            const personalPct = safeDivide(personalSales, total);
            const compartirPct = safeDivide(compartirSales, total);
            const otrosPct = safeDivide(otrosSales, total);
            const pieData = [
              { name: 'Personal', value: personalSales },
              { name: 'Para Compartir', value: compartirSales },
              ...(otrosSales > 0 ? [{ name: 'Complementos', value: otrosSales }] : []),
            ];

            return (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        <Cell fill="#272121" />
                        <Cell fill="#ff0024" />
                        {otrosSales > 0 && <Cell fill="#64748b" />}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#272121]" />
                      <span className="text-sm">Personal</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold">{formatCurrency(personalSales)}</span>
                      <span className="font-mono text-xs font-bold bg-[#272121] text-[#d1d0d1] px-2 py-0.5 rounded">{formatPercent(personalPct)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-[#ff0024]" />
                      <span className="text-sm">Para Compartir</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold">{formatCurrency(compartirSales)}</span>
                      <span className="font-mono text-xs font-bold bg-[#ff0024] text-white px-2 py-0.5 rounded">{formatPercent(compartirPct)}</span>
                    </div>
                  </div>
                  {otrosSales > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-[#64748b]" />
                        <span className="text-sm">Complementos</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold">{formatCurrency(otrosSales)}</span>
                        <span className="font-mono text-xs font-bold bg-[#64748b] text-white px-2 py-0.5 rounded">{formatPercent(otrosPct)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Channel Sales Ranking */}
      {channelData.length > 0 && (
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Ranking de Ventas por Canal</h3>
          {(() => {
            const channelTotals = Object.entries(
              channelData.reduce<Record<string, number>>((acc, d) => {
                acc[d.channel] = (acc[d.channel] || 0) + d.sales;
                return acc;
              }, {})
            )
              .map(([channel, sales]) => ({ channel, sales }))
              .sort((a, b) => b.sales - a.sales);

            const maxSales = channelTotals[0]?.sales || 1;

            return (
              <div className="space-y-4">
                {channelTotals.map((ch, i) => {
                  const pct = safeDivide(ch.sales, channelTotals.reduce((a, c) => a + c.sales, 0));
                  const color = CHANNEL_COLORS[ch.channel] || '#272121';
                  return (
                    <div key={ch.channel} className="flex items-center gap-4">
                      <div className="w-8 flex justify-center">
                        {i === 0 ? <Crown size={20} className="text-amber-500" /> :
                         i === 1 ? <Medal size={18} className="text-gray-400" /> :
                         <Medal size={16} className="text-amber-700" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-sm font-medium">{ch.channel}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-bold">{formatCurrency(ch.sales)}</span>
                            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: color, color: ['#fcec0e', '#d1d0d1'].includes(color) ? '#272121' : '#fff' }}>
                              {formatPercent(pct)}
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-2.5 bg-[#272121]/5 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(ch.sales / maxSales) * 100}%` }}
                            transition={{ duration: 0.8, delay: i * 0.15, ease: 'easeOut' }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Top Producto por Familia */}
      {productData.length > 0 && (() => {
        const families = [...new Set(productData.map(d => d.family))];
        const familyColorPalette = ['#272121', '#4a9eff', '#ff0024', '#1e3a5f', '#fcec0e', '#e85d75', '#ff8c42', '#7c5cbf', '#2dd4bf', '#f472b6', '#64748b', '#0ea5e9'];
        const familyColors: Record<string, string> = Object.fromEntries(families.map((f, i) => [f, familyColorPalette[i % familyColorPalette.length]]));
        const topByFamily = families.map(family => {
          const products = aggregateProducts(productData.filter(d => d.family === family));
          const totalFamilySales = products.reduce((a, c) => a + c.sales, 0);
          const totalFamilyQty = products.reduce((a, c) => a + c.quantity, 0);
          const totalFamilyCost = products.reduce((a, c) => a + c.cost, 0);
          return { family, top: products[0] || null, topThree: products.slice(0, 3), totalSales: totalFamilySales, totalQty: totalFamilyQty, totalMargin: totalFamilySales - totalFamilyCost, productCount: products.length };
        });

        return (
          <div>
            <h3 className="font-bold text-xl mb-6">Mejor Producto por Familia</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {topByFamily.map(({ family, top, topThree, totalSales, totalQty, totalMargin, productCount }) => {
                const color = familyColors[family] || '#272121';
                return (
                  <motion.div
                    key={family}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm"
                    style={{ borderTop: `4px solid ${color}` }}
                  >
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-lg">{family}</h4>
                        <span className="text-[10px] font-mono opacity-40">{productCount} productos</span>
                      </div>
                      {top && (
                        <div className="bg-black/[0.03] rounded-xl p-4 mb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Crown size={14} className="text-amber-500" />
                            <span className="text-[10px] uppercase tracking-widest opacity-40 font-mono font-bold">Más vendido</span>
                          </div>
                          <p className="font-medium text-sm mb-1">{top.product_name}</p>
                          <p className="text-xl font-bold tracking-tighter">{formatCurrency(top.sales)}</p>
                          <p className="text-[11px] font-mono opacity-50 mt-1">{top.quantity} uds · Margen {formatPercent(safeDivide(top.sales - top.cost, top.sales))}</p>
                        </div>
                      )}
                      <div className="space-y-2">
                        {topThree.map((p, i) => {
                          const pct = safeDivide(p.sales, totalSales);
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <span className="w-5 text-center">
                                {i === 0 ? <Crown size={12} className="text-amber-500" /> :
                                 i === 1 ? <Medal size={12} className="text-gray-400" /> :
                                 <Medal size={12} className="text-amber-700" />}
                              </span>
                              <span className="text-xs truncate flex-1">{p.product_name}</span>
                              <span className="font-mono text-[10px] font-bold">{formatPercent(pct)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#272121]/5 grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest opacity-40 font-mono">Ventas</p>
                          <p className="text-sm font-bold">{formatCompact(totalSales)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest opacity-40 font-mono">Cant</p>
                          <p className="text-sm font-bold">{totalQty}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest opacity-40 font-mono">Margen</p>
                          <p className="text-sm font-bold">{formatCompact(totalMargin)}</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── ComparativeTypeView ──────────────────────────────────────────────

function ComparativeTypeView({ data }: { data: ComparativeData[] }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'both' | 'personal' | 'compartir'>('both');
  const personal = data.filter(d => d.is_personal === 1);
  const nonPersonal = data.filter(d => d.is_personal === 0);

  const totalPersonalSales = personal.reduce((a, c) => a + c.sales, 0);
  const totalNonPersonalSales = nonPersonal.reduce((a, c) => a + c.sales, 0);
  const totalQuantity = data.reduce((a, c) => a + c.quantity, 0);
  const totalSales = data.reduce((a, c) => a + c.sales, 0);
  const totalCost = data.reduce((a, c) => a + c.cost, 0);
  const avgMargin = safeDivide(totalSales - totalCost, totalSales);

  const families = [...new Set(data.filter(d => d.is_personal !== -1).map(d => d.family))];
  const chartData = families.map(family => {
    const p = personal.find(d => d.family === family);
    const np = nonPersonal.find(d => d.family === family);
    return {
      family,
      Personal: p?.sales || 0,
      'Para Compartir': np?.sales || 0,
    };
  }).sort((a, b) => (a.Personal + a['Para Compartir']) - (b.Personal + b['Para Compartir']));

  return (
    <div className="space-y-8">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold mr-1">Vista</span>
        {([['both', 'Ambos'], ['personal', 'Personal'], ['compartir', 'Para Compartir']] as const).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-mono transition-all border",
              viewMode === mode
                ? "bg-[#272121] text-[#d1d0d1] border-[#272121] shadow-md"
                : "border-[#272121]/20 hover:border-[#272121]/50"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Single Type Full-Width View */}
      {viewMode !== 'both' ? (
        <TypePanel
          title={viewMode === 'personal' ? 'Personales' : 'Para Compartir'}
          data={viewMode === 'personal' ? personal : nonPersonal}
          accentColor={viewMode === 'personal' ? '#272121' : '#ff0024'}
          fullWidth
        />
      ) : (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Total Ventas"
          value={formatCurrency(totalPersonalSales + totalNonPersonalSales)}
          icon={<DollarSign size={20} />}
          subtitle="Personales + Compartir"
        />
        <KpiCard
          title="Total Personales"
          value={formatCurrency(totalPersonalSales)}
          icon={<Users size={20} />}
          subtitle={`${formatPercent(safeDivide(totalPersonalSales, totalPersonalSales + totalNonPersonalSales))} del total`}
        />
        <KpiCard
          title="Total Para Compartir"
          value={formatCurrency(totalNonPersonalSales)}
          icon={<ShoppingBag size={20} />}
          subtitle={`${formatPercent(safeDivide(totalNonPersonalSales, totalPersonalSales + totalNonPersonalSales))} del total`}
        />
        <KpiCard title="Cantidad Total" value={totalQuantity.toString()} icon={<Package size={20} />} subtitle="unidades" />
        <KpiCard title="Margen Bruto de Ganancia" value={formatPercent(avgMargin)} icon={<TrendingUp size={20} />} subtitle="No incluye gastos operativos (arriendo, sueldos, servicios, comisiones)" />
      </div>

      {/* Grouped Bar Chart */}
      <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="font-bold text-xl mb-6">Ventas por Familia — Personal vs Compartir</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#272121" strokeOpacity={0.05} />
              <XAxis dataKey="family" axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.6 }} />
              <YAxis axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.4 }} tickFormatter={v => formatCompact(v)} />
              <Tooltip
                cursor={{ fill: '#272121', opacity: 0.05 }}
                contentStyle={tooltipStyle}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Legend />
              <Bar dataKey="Personal" fill="#272121" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="Personal" position="top" fontSize={10} fill="#272121" opacity={0.4} formatter={(v: number) => formatCompact(v)} />
              </Bar>
              <Bar dataKey="Para Compartir" fill="#ff0024" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="Para Compartir" position="top" fontSize={10} fill="#ff0024" opacity={0.7} formatter={(v: number) => formatCompact(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparison Card */}
      <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="font-bold text-xl mb-6">Comparativa Personal vs Para Compartir</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#272121]/10">
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Métrica</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#272121] mr-1.5 align-middle" />Personal
                </th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ff0024] mr-1.5 align-middle" />Para Compartir
                </th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Diferencia</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-center">Distribución</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const pSales = totalPersonalSales;
                const npSales = totalNonPersonalSales;
                const pQty = personal.reduce((a, c) => a + c.quantity, 0);
                const npQty = nonPersonal.reduce((a, c) => a + c.quantity, 0);
                const pCost = personal.reduce((a, c) => a + c.cost, 0);
                const npCost = nonPersonal.reduce((a, c) => a + c.cost, 0);
                const pMargin = pSales - pCost;
                const npMargin = npSales - npCost;
                const pMarginPct = safeDivide(pMargin, pSales);
                const npMarginPct = safeDivide(npMargin, npSales);

                // higherIsBetter: true = el mayor valor gana (ventas, margen), false = el menor gana (costo)
                type FamilyExtractor = { pExtract: (d?: ComparativeData) => number; npExtract: (d?: ComparativeData) => number };
                const rows: { label: string; pRaw: number; npRaw: number; p: string; np: string; diff: string; pPct: number | null; higherWins: boolean; familyData: FamilyExtractor | null }[] = [
                  { label: 'Ventas', pRaw: pSales, npRaw: npSales, p: formatCurrency(pSales), np: formatCurrency(npSales), diff: formatCurrency(pSales - npSales), pPct: safeDivide(pSales, totalSales), higherWins: true, familyData: { pExtract: d => d?.sales || 0, npExtract: d => d?.sales || 0 } },
                  { label: 'Cantidad', pRaw: pQty, npRaw: npQty, p: pQty.toString(), np: npQty.toString(), diff: (pQty - npQty).toString(), pPct: safeDivide(pQty, pQty + npQty), higherWins: true, familyData: { pExtract: d => d?.quantity || 0, npExtract: d => d?.quantity || 0 } },
                  { label: 'Costo', pRaw: pCost, npRaw: npCost, p: formatCurrency(pCost), np: formatCurrency(npCost), diff: formatCurrency(pCost - npCost), pPct: safeDivide(pCost, pCost + npCost), higherWins: false, familyData: { pExtract: d => d?.cost || 0, npExtract: d => d?.cost || 0 } },
                  { label: 'Margen $', pRaw: pMargin, npRaw: npMargin, p: formatCurrency(pMargin), np: formatCurrency(npMargin), diff: formatCurrency(pMargin - npMargin), pPct: safeDivide(pMargin, pMargin + npMargin), higherWins: true, familyData: { pExtract: d => (d?.sales || 0) - (d?.cost || 0), npExtract: d => (d?.sales || 0) - (d?.cost || 0) } },
                  { label: '% Margen', pRaw: pMarginPct, npRaw: npMarginPct, p: formatPercent(pMarginPct), np: formatPercent(npMarginPct), diff: formatPercent(pMarginPct - npMarginPct), pPct: null, higherWins: true, familyData: { pExtract: d => safeDivide((d?.sales || 0) - (d?.cost || 0), d?.sales || 0), npExtract: d => safeDivide((d?.sales || 0) - (d?.cost || 0), d?.sales || 0) } },
                ];

                return rows.map((row, i) => {
                  // Determine winner: for cost, lower is better
                  const pWins = row.higherWins ? row.pRaw > row.npRaw : row.pRaw < row.npRaw;
                  const npWins = row.higherWins ? row.npRaw > row.pRaw : row.npRaw < row.pRaw;
                  const tie = row.pRaw === row.npRaw;
                  const isExpanded = expandedRow === row.label;

                  // Build per-family breakdown for expanded view
                  const familyBreakdown = row.familyData ? families.map(family => {
                    const pRow = personal.find(d => d.family === family);
                    const npRow = nonPersonal.find(d => d.family === family);
                    return {
                      family,
                      Personal: row.familyData!.pExtract(pRow),
                      'Para Compartir': row.familyData!.npExtract(npRow),
                    };
                  }) : null;

                  return (
                    <React.Fragment key={i}>
                      <tr
                        className={cn(
                          "border-b border-[#272121]/5 transition-colors cursor-pointer select-none",
                          isExpanded ? "bg-black/[0.04]" : "hover:bg-black/[0.03]"
                        )}
                        onClick={() => setExpandedRow(isExpanded ? null : row.label)}
                      >
                        <td className="p-4 font-medium text-sm">
                          <span className="inline-flex items-center gap-2">
                            <motion.span
                              animate={{ rotate: isExpanded ? 0 : -90 }}
                              transition={{ duration: 0.2 }}
                              className="text-[#272121]/30"
                            >
                              <ChevronDown size={14} />
                            </motion.span>
                            {row.label}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono text-sm">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors",
                            !tie && pWins && "bg-[#272121]/10 font-bold"
                          )}>
                            {!tie && pWins && <ArrowUpRight size={12} className="text-[#272121]" />}
                            {row.p}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono text-sm">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors",
                            !tie && npWins && "bg-[#ff0024]/15 font-bold"
                          )}>
                            {!tie && npWins && <ArrowUpRight size={12} className="text-[#ff0024]" />}
                            {row.np}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono text-sm">{row.diff}</td>
                        <td className="p-4">
                          {row.pPct !== null && (
                            <div className="flex items-center gap-2 justify-center">
                              <span className="font-mono text-[11px] font-bold w-12 text-right">{formatPercent(row.pPct)}</span>
                              <div className="w-28 h-2.5 bg-[#ff0024]/20 rounded-full overflow-hidden">
                                <div className="h-full bg-[#272121] rounded-full transition-all duration-500" style={{ width: `${row.pPct * 100}%` }} />
                              </div>
                              <span className="font-mono text-[11px] font-bold w-12">{formatPercent(1 - row.pPct)}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                      <AnimatePresence>
                        {isExpanded && familyBreakdown && (
                          <tr>
                            <td colSpan={5} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                                className="overflow-hidden"
                              >
                                <div className="px-6 py-4 bg-black/[0.02] border-b border-[#272121]/5">
                                  <p className="text-[11px] font-mono uppercase tracking-widest opacity-40 mb-3">
                                    {row.label} por familia
                                  </p>
                                  <div className="h-44">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={familyBreakdown} barGap={2} margin={{ top: 15, right: 10, bottom: 0, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#272121" strokeOpacity={0.05} />
                                        <XAxis dataKey="family" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#272121', opacity: 0.5 }} />
                                        <YAxis axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#272121', opacity: 0.3 }} tickFormatter={v => row.label === '% Margen' ? formatPercent(v) : formatCompact(v)} />
                                        <Tooltip
                                          cursor={{ fill: '#272121', opacity: 0.04 }}
                                          contentStyle={tooltipStyle}
                                          formatter={(value: number) => row.label === '% Margen' ? formatPercent(value) : row.label === 'Cantidad' ? value.toString() : formatCurrency(value)}
                                        />
                                        <Bar dataKey="Personal" fill="#272121" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="Para Compartir" fill="#ff0024" radius={[4, 4, 0, 0]} />
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tables — sorted by sales desc */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <TypePanel title="Personales" data={personal} accentColor="#272121" />
        <TypePanel title="Para Compartir" data={nonPersonal} accentColor="#ff0024" />
      </div>

      {/* Profitability Rankings — Personal & Compartir */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {[
          { title: 'Ranking Rentabilidad — Personal', rows: personal, accent: '#272121' },
          { title: 'Ranking Rentabilidad — Para Compartir', rows: nonPersonal, accent: '#ff0024' },
        ].map(({ title: rankTitle, rows: rankRows, accent }) => (
          <div key={rankTitle} className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="font-bold text-lg mb-2">{rankTitle}</h3>
            <p className="text-[11px] font-mono opacity-40 mb-4">Ordenado por rentabilidad (margen / costo)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#272121]/10">
                    <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold w-10">#</th>
                    <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Familia</th>
                    <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Ventas</th>
                    <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Margen</th>
                    <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Rentab.</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rankRows]
                    .sort((a, b) => safeDivide(b.sales - b.cost, b.cost) - safeDivide(a.sales - a.cost, a.cost))
                    .map((row, i) => {
                      const margin = row.sales - row.cost;
                      const rentab = safeDivide(margin, row.cost);
                      return (
                        <tr key={i} className="border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors">
                          <td className="p-3">
                            {i === 0 ? <Crown size={16} className="text-amber-500" /> :
                             i === 1 ? <Medal size={16} className="text-gray-400" /> :
                             i === 2 ? <Medal size={16} className="text-amber-700" /> :
                             <span className="font-mono text-sm opacity-40">{i + 1}</span>}
                          </td>
                          <td className="p-3 font-medium text-sm">{row.family}</td>
                          <td className="p-3 text-right font-mono text-xs">{formatCurrency(row.sales)}</td>
                          <td className="p-3 text-right font-mono text-xs font-bold">{formatCurrency(margin)}</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-mono text-[11px] font-bold">{formatPercent(rentab)}</span>
                              <div className="w-14 h-2 bg-black/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${Math.min(rentab * 50, 100)}%`,
                                    backgroundColor: accent,
                                  }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

function TypePanel({ title, data, accentColor, fullWidth }: { title: string, data: ComparativeData[], accentColor: string, fullWidth?: boolean }) {
  const sorted = [...data].sort((a, b) => b.sales - a.sales);
  const groupTotal = data.reduce((a, c) => a + c.sales, 0);
  const groupQty = data.reduce((a, c) => a + c.quantity, 0);
  const groupCost = data.reduce((a, c) => a + c.cost, 0);

  const rankIcon = (pos: number) => {
    if (pos === 0) return <Crown size={15} className="text-amber-500" />;
    if (pos === 1) return <Medal size={15} className="text-gray-400" />;
    if (pos === 2) return <Medal size={15} className="text-amber-700" />;
    return <span className="font-mono text-[11px] opacity-30">{pos + 1}</span>;
  };

  const pieData = sorted.map(r => ({ name: r.family, value: r.sales }));
  const pieColors = ['#272121', '#ff0024', '#fcec0e', '#1e3a5f', '#e85d75', '#4a9eff', '#ff8c42', '#7c5cbf', '#2dd4bf', '#f472b6', '#64748b', '#0ea5e9'];

  const tableContent = (
    <div className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm">
      <div className="p-6 border-b border-[#272121]/10 flex items-center justify-between" style={{ borderLeft: `4px solid ${accentColor}` }}>
        <h3 className="font-bold text-2xl">{title}</h3>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono mb-1">Ventas Totales</p>
          <p className="font-black text-3xl tracking-tight" style={{ color: accentColor }}>{formatCurrency(groupTotal)}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Table */}
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#272121]/10">
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold w-10"></th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Familia</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Cant</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Ventas</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Costo</th>
                <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">% Cant</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i} className={cn(
                  "border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors",
                  i === 0 && "bg-amber-50/40"
                )}>
                  <td className="p-4 text-center">{rankIcon(i)}</td>
                  <td className="p-4 font-medium">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                      {row.family}
                    </div>
                  </td>
                  <td className="p-4 text-right font-mono text-xs opacity-60">{row.quantity}</td>
                  <td className="p-4 text-right font-mono text-xs font-bold">{formatCurrency(row.sales)}</td>
                  <td className="p-4 text-right font-mono text-xs opacity-60">{formatCurrency(row.cost)}</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-mono text-[11px] font-bold">{formatPercent(safeDivide(row.quantity, groupQty))}</span>
                      <div className="w-14 h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${safeDivide(row.quantity, groupQty) * 100}%`, backgroundColor: accentColor }} />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#272121]/10 font-bold bg-black/[0.02]">
                <td className="p-4"></td>
                <td className="p-4">Total</td>
                <td className="p-4 text-right font-mono text-xs">{groupQty}</td>
                <td className="p-4 text-right font-mono text-xs">{formatCurrency(groupTotal)}</td>
                <td className="p-4 text-right font-mono text-xs opacity-60">{formatCurrency(groupCost)}</td>
                <td className="p-4 text-right font-mono text-[11px]">100,0%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Inline Pie Chart (compact mode only) */}
        {!fullWidth && (
          <div className="w-full lg:w-52 shrink-0 flex flex-col items-center justify-center p-4 lg:border-l border-t lg:border-t-0 border-[#272121]/5">
            <p className="text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold mb-2">% Ventas</p>
            <div className="w-36 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={30} outerRadius={55} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {pieData.map((_, idx) => <Cell key={idx} fill={pieColors[idx % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 mt-2 w-full">
              {sorted.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                    <span className="truncate">{row.family}</span>
                  </div>
                  <span className="font-mono font-bold shrink-0">{formatPercent(safeDivide(row.sales, groupTotal))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (fullWidth) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {tableContent}

        {/* Separate large Pie Chart card */}
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm flex flex-col">
          <div className="p-6 border-b border-[#272121]/10">
            <h3 className="font-bold text-xl">Distribución por Familia</h3>
            <p className="text-[11px] font-mono opacity-40 mt-1">Proporción de ventas por familia</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-64 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((_, idx) => <Cell key={idx} fill={pieColors[idx % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 mt-6 w-full max-w-xs">
              {sorted.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-sm gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                    <span className="font-medium">{row.family}</span>
                  </div>
                  <span className="font-mono font-bold">{formatPercent(safeDivide(row.sales, groupTotal))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return tableContent;
}

// ── ChannelView ──────────────────────────────────────────────────────

function ChannelView({ data }: { data: ChannelData[] }) {
  const channels = [...new Set(data.map(d => d.channel))];
  const families = [...new Set(data.map(d => d.family))];
  const [viewChannel, setViewChannel] = useState<string | null>(null);

  const chartData = families.map(family => {
    const entry: Record<string, string | number> = { family };
    let total = 0;
    for (const ch of channels) {
      const row = data.find(d => d.family === family && d.channel === ch);
      const sales = row?.sales || 0;
      entry[ch] = sales;
      total += sales;
    }
    entry._total = total;
    return entry;
  }).sort((a, b) => (a._total as number) - (b._total as number));

  return (
    <div className="space-y-8">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold mr-1">Vista</span>
        <button
          onClick={() => setViewChannel(null)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-mono transition-all border",
            viewChannel === null
              ? "bg-[#272121] text-[#d1d0d1] border-[#272121] shadow-md"
              : "border-[#272121]/20 hover:border-[#272121]/50"
          )}
        >
          Todos
        </button>
        {channels.map(ch => (
          <button
            key={ch}
            onClick={() => setViewChannel(ch)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-mono transition-all border",
              viewChannel === ch
                ? "text-[#d1d0d1] border-transparent shadow-md"
                : "border-[#272121]/20 hover:border-[#272121]/50"
            )}
            style={viewChannel === ch ? { backgroundColor: CHANNEL_COLORS[ch] || '#272121' } : undefined}
          >
            {ch}
          </button>
        ))}
      </div>

      {viewChannel ? (
        <ChannelDetailPanel channel={viewChannel} data={data.filter(d => d.channel === viewChannel)} allData={data} />
      ) : (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {channels.map(channel => {
          const rows = data.filter(d => d.channel === channel);
          const sales = rows.reduce((a, c) => a + c.sales, 0);
          const commission = sales * (CHANNEL_COMMISSION[channel] || 0);
          const cost = rows.reduce((a, c) => a + c.cost, 0);
          const qty = rows.reduce((a, c) => a + c.quantity, 0);
          const margin = sales - cost - commission;
          const totalSales = data.reduce((a, c) => a + c.sales, 0);
          return (
            <motion.div
              key={channel}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm hover:border-[#272121]/20 transition-all"
              style={{ borderLeft: `4px solid ${CHANNEL_COLORS[channel] || '#272121'}` }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">{channel}</h3>
                <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-md bg-black/5">
                  {formatPercent(safeDivide(sales, totalSales))}
                </span>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono">Ventas</p>
                  <p className="text-2xl font-bold tracking-tighter">{formatCurrency(sales)}</p>
                </div>
                <div className="flex gap-5">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono">Cantidad</p>
                    <p className="text-lg font-medium">{qty}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono">Margen</p>
                    <p className="text-lg font-medium">{formatCurrency(margin)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono">% Margen</p>
                    <p className="text-lg font-medium">{formatPercent(safeDivide(margin, sales))}</p>
                  </div>
                </div>
                {commission > 0 && (
                  <div className="pt-2 mt-1 border-t border-[#272121]/5 flex items-center gap-2">
                    <AlertCircle size={13} className="text-[#ff0024] shrink-0" />
                    <span className="text-[11px] font-mono opacity-60">
                      Comisión plataforma: {formatPercent(CHANNEL_COMMISSION[channel])} = {formatCurrency(commission)}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bar Chart — Sales by Family */}
      <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="font-bold text-xl mb-6">Ventas por Familia</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.map(d => ({ family: d.family, sales: d._total }))} barSize={40}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#272121" strokeOpacity={0.05} />
              <XAxis dataKey="family" axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.6 }} />
              <YAxis axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.4 }} tickFormatter={v => formatCompact(v)} />
              <Tooltip
                cursor={{ fill: '#272121', opacity: 0.05 }}
                contentStyle={tooltipStyle}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Bar dataKey="sales" fill="#272121" radius={[6, 6, 0, 0]}>
                <LabelList dataKey="sales" position="top" fontSize={10} fill="#272121" opacity={0.5} formatter={(v: number) => formatCompact(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparison Card */}
      {channels.length > 1 && (() => {
        const totalSales = data.reduce((a, c) => a + c.sales, 0);
        const totalQty = data.reduce((a, c) => a + c.quantity, 0);
        const totalCost = data.reduce((a, c) => a + c.cost, 0);

        const channelStats = channels.map(ch => {
          const rows = data.filter(d => d.channel === ch);
          const sales = rows.reduce((a, c) => a + c.sales, 0);
          const commission = sales * (CHANNEL_COMMISSION[ch] || 0);
          const qty = rows.reduce((a, c) => a + c.quantity, 0);
          const cost = rows.reduce((a, c) => a + c.cost, 0);
          const margin = sales - cost - commission;
          return { ch, sales, qty, cost, commission, margin, marginPct: safeDivide(margin, sales), ticket: safeDivide(sales, qty) };
        });

        const metrics = [
          { label: 'Ventas', raws: channelStats.map(s => s.sales), values: channelStats.map(s => formatCurrency(s.sales)), pcts: channelStats.map(s => safeDivide(s.sales, totalSales)), higherWins: true },
          { label: 'Cantidad', raws: channelStats.map(s => s.qty), values: channelStats.map(s => s.qty.toString()), pcts: channelStats.map(s => safeDivide(s.qty, totalQty)), higherWins: true },
          { label: 'Costo', raws: channelStats.map(s => s.cost), values: channelStats.map(s => formatCurrency(s.cost)), pcts: channelStats.map(s => safeDivide(s.cost, totalCost)), higherWins: false },
          { label: 'Margen $', raws: channelStats.map(s => s.margin), values: channelStats.map(s => formatCurrency(s.margin)), pcts: channelStats.map(s => safeDivide(s.margin, channelStats.reduce((a, c) => a + c.margin, 0))), higherWins: true },
          { label: '% Margen', raws: channelStats.map(s => s.marginPct), values: channelStats.map(s => formatPercent(s.marginPct)), pcts: null, higherWins: true },
        ];

        return (
          <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="font-bold text-xl mb-6">Comparativa entre Canales</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#272121]/10">
                    <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Métrica</th>
                    {channelStats.map(s => (
                      <th key={s.ch} className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: CHANNEL_COLORS[s.ch] || '#999' }} />
                        {s.ch}
                      </th>
                    ))}
                    <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-center">Distribución</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((row, i) => {
                    const bestVal = row.higherWins ? Math.max(...row.raws) : Math.min(...row.raws);
                    const bestIdx = row.raws.indexOf(bestVal);
                    const allEqual = row.raws.every(v => v === row.raws[0]);

                    return (
                      <tr key={i} className="border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors">
                        <td className="p-4 font-medium text-sm">{row.label}</td>
                        {row.values.map((v, j) => {
                          const isWinner = !allEqual && j === bestIdx;
                          const color = CHANNEL_COLORS[channelStats[j].ch] || '#999';
                          return (
                            <td key={j} className="p-4 text-right font-mono text-sm">
                              <span className={cn(
                                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors",
                                isWinner && "font-bold"
                              )} style={isWinner ? { backgroundColor: `${color}15` } : undefined}>
                                {isWinner && <ArrowUpRight size={12} style={{ color }} />}
                                {v}
                              </span>
                            </td>
                          );
                        })}
                        <td className="p-4">
                          {row.pcts && (
                            <div className="flex items-center gap-0.5 justify-center">
                              {row.pcts.map((pct, j) => (
                                <div key={j} className="flex items-center gap-1">
                                  <div
                                    className="h-2.5 rounded-full min-w-[4px] transition-all duration-500"
                                    style={{
                                      width: `${Math.max(pct * 90, 4)}px`,
                                      backgroundColor: CHANNEL_COLORS[channelStats[j].ch] || '#999',
                                    }}
                                  />
                                  <span className="font-mono text-[11px] font-bold mr-2">{formatPercent(pct)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {channelStats.some(s => s.commission > 0) && (
              <div className="mt-4 pt-4 border-t border-[#272121]/5 flex items-start gap-2 px-1">
                <AlertCircle size={14} className="text-[#ff0024] shrink-0 mt-0.5" />
                <p className="text-[11px] font-mono opacity-50 leading-relaxed">
                  Margen y % Margen incluyen descuento por comisiones de plataforma:
                  {channelStats.filter(s => s.commission > 0).map(s => (
                    <span key={s.ch} className="ml-1 font-bold opacity-80">
                      {s.ch} {formatPercent(CHANNEL_COMMISSION[s.ch])} ({formatCurrency(s.commission)})
                    </span>
                  ))}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Detail Panels — Visual */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {channels.map(channel => {
          const rows = data.filter(d => d.channel === channel);
          const chColor = CHANNEL_COLORS[channel] || '#272121';
          const commRate = CHANNEL_COMMISSION[channel] || 0;
          const channelSales = rows.reduce((a, c) => a + c.sales, 0);
          const maxSales = Math.max(...rows.map(r => r.sales));

          // Ensure all families are present
          const allFamilies = [...new Set(data.map(d => d.family))];
          const fullRows = allFamilies.map(family => {
            const existing = rows.find(r => r.family === family);
            return existing || { channel, family, quantity: 0, sales: 0, cost: 0 };
          });

          const enriched = fullRows.map(row => {
            const commission = row.sales * commRate;
            const profit = row.sales - row.cost - commission;
            const marginPct = safeDivide(profit, row.sales);
            const salesPct = safeDivide(row.sales, channelSales);
            return { ...row, profit, marginPct, salesPct, commission };
          }).sort((a, b) => b.sales - a.sales);

          // Pie data for sales distribution
          const pieData = enriched.map(r => ({ name: r.family, value: r.sales }));
          const pieColors = ['#272121', '#ff0024', '#fcec0e', '#1e3a5f', '#e85d75', '#4a9eff', '#ff8c42', '#7c5cbf', '#2dd4bf', '#f472b6', '#64748b', '#0ea5e9'];

          return (
            <div key={channel} className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm">
              <div className="p-5 border-b border-[#272121]/10" style={{ borderLeft: `4px solid ${chColor}` }}>
                <h4 className="font-bold text-lg">{channel}</h4>
                <p className="text-[11px] font-mono opacity-40 mt-1">Ventas: {formatCurrency(channelSales)}</p>
              </div>

              {/* Mini Donut — Sales Distribution */}
              <div className="px-5 pt-4">
                <p className="text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold mb-2">Distribución de ventas</p>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} innerRadius={22} outerRadius={38} paddingAngle={3} dataKey="value" strokeWidth={0}>
                          {pieData.map((_, idx) => <Cell key={idx} fill={pieColors[idx % pieColors.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {enriched.map((row, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                        <span className="truncate flex-1">{row.family}</span>
                        <span className="font-mono font-bold">{formatPercent(row.salesPct)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Horizontal Bars — Sales by Family */}
              <div className="px-5 pt-5">
                <p className="text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold mb-3">Ventas por familia</p>
                <div className="space-y-3">
                  {enriched.map((row, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{row.family}</span>
                        <span className="font-mono text-xs font-bold">{formatCurrency(row.sales)}</span>
                      </div>
                      <div className="w-full h-2.5 bg-black/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${safeDivide(row.sales, maxSales) * 100}%` }}
                          transition={{ duration: 0.6, delay: i * 0.1 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: chColor }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Margin Bars */}
              <div className="px-5 pt-5 pb-5">
                <p className="text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold mb-3">Margen por familia</p>
                <div className="space-y-2.5">
                  {enriched.map((row, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs w-28 truncate">{row.family}</span>
                      <div className="flex-1 h-4 bg-black/5 rounded-full overflow-hidden relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${row.marginPct * 100}%` }}
                          transition={{ duration: 0.6, delay: i * 0.1 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: '#1e3a5f' }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold" style={{ color: row.marginPct > 0.45 ? '#fff' : '#272121' }}>
                          {formatPercent(row.marginPct)}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] w-20 text-right">{formatCurrency(row.profit)}</span>
                    </div>
                  ))}
                </div>
                {commRate > 0 && (
                  <div className="mt-3 pt-2 border-t border-[#272121]/5 flex items-center gap-2">
                    <AlertCircle size={12} className="text-[#ff0024] shrink-0" />
                    <span className="text-[10px] font-mono opacity-50">
                      Margen incluye comisión {formatPercent(commRate)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

// ── ChannelDetailPanel (single channel full-width) ───────────────────

function ChannelDetailPanel({ channel, data, allData }: { channel: string, data: ChannelData[], allData: ChannelData[] }) {
  const chColor = CHANNEL_COLORS[channel] || '#272121';
  const commRate = CHANNEL_COMMISSION[channel] || 0;
  const channelSales = data.reduce((a, c) => a + c.sales, 0);
  const channelQty = data.reduce((a, c) => a + c.quantity, 0);
  const channelCost = data.reduce((a, c) => a + c.cost, 0);
  const totalCommission = channelSales * commRate;
  const channelMargin = channelSales - channelCost - totalCommission;
  const totalSales = allData.reduce((a, c) => a + c.sales, 0);
  const maxSales = Math.max(...data.map(r => r.sales));

  const enriched = data.map(row => {
    const commission = row.sales * commRate;
    const profit = row.sales - row.cost - commission;
    const marginPct = safeDivide(profit, row.sales);
    const salesPct = safeDivide(row.sales, channelSales);
    return { ...row, profit, marginPct, salesPct, commission };
  }).sort((a, b) => b.sales - a.sales);

  const pieData = enriched.map(r => ({ name: r.family, value: r.sales }));
  const pieColors = ['#272121', '#ff0024', '#fcec0e', '#1e3a5f', '#e85d75', '#4a9eff', '#ff8c42', '#7c5cbf', '#2dd4bf', '#f472b6', '#64748b', '#0ea5e9'];

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Ventas"
          value={formatCurrency(channelSales)}
          icon={<DollarSign size={20} />}
          subtitle={`${formatPercent(safeDivide(channelSales, totalSales))} del total`}
        />
        <KpiCard
          title="Cantidad"
          value={channelQty.toString()}
          icon={<Package size={20} />}
          subtitle="unidades vendidas"
        />
        <KpiCard
          title="Margen Neto"
          value={formatCurrency(channelMargin)}
          icon={<TrendingUp size={20} />}
          subtitle={`${formatPercent(safeDivide(channelMargin, channelSales))} de margen`}
        />
      </div>

      {/* Table + Pie side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Table Card */}
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm">
          <div className="p-6 border-b border-[#272121]/10 flex items-center justify-between" style={{ borderLeft: `4px solid ${chColor}` }}>
            <h3 className="font-bold text-2xl">{channel}</h3>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-widest opacity-50 font-mono">Ventas Totales</p>
              <p className="font-bold text-lg">{formatCurrency(channelSales)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#272121]/10">
                  <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold w-10"></th>
                  <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Familia</th>
                  <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Cant</th>
                  <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Ventas</th>
                  <th className="p-4 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((row, i) => (
                  <tr key={i} className={cn(
                    "border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors",
                    i === 0 && "bg-amber-50/40"
                  )}>
                    <td className="p-4 text-center">
                      {i === 0 ? <Crown size={15} className="text-amber-500" /> :
                       i === 1 ? <Medal size={15} className="text-gray-400" /> :
                       i === 2 ? <Medal size={15} className="text-amber-700" /> :
                       <span className="font-mono text-[11px] opacity-30">{i + 1}</span>}
                    </td>
                    <td className="p-4 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                        {row.family}
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono text-xs opacity-60">{row.quantity}</td>
                    <td className="p-4 text-right font-mono text-xs font-bold">{formatCurrency(row.sales)}</td>
                    <td className="p-4 text-right font-mono text-xs font-bold">{formatCurrency(row.profit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#272121]/10 font-bold bg-black/[0.02]">
                  <td className="p-4"></td>
                  <td className="p-4">Total</td>
                  <td className="p-4 text-right font-mono text-xs">{channelQty}</td>
                  <td className="p-4 text-right font-mono text-xs">{formatCurrency(channelSales)}</td>
                  <td className="p-4 text-right font-mono text-xs">{formatCurrency(channelMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {commRate > 0 && (
            <div className="px-6 py-3 border-t border-[#272121]/5 flex items-center gap-2">
              <AlertCircle size={13} className="text-[#ff0024] shrink-0" />
              <span className="text-[11px] font-mono opacity-60">
                Comisión plataforma: {formatPercent(commRate)} = {formatCurrency(totalCommission)}
              </span>
            </div>
          )}
        </div>

        {/* Separate large Pie Chart card */}
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl overflow-hidden backdrop-blur-sm flex flex-col">
          <div className="p-6 border-b border-[#272121]/10">
            <h3 className="font-bold text-xl">Distribución por Familia</h3>
            <p className="text-[11px] font-mono opacity-40 mt-1">Proporción de ventas por familia</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-64 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((_, idx) => <Cell key={idx} fill={pieColors[idx % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 mt-6 w-full max-w-xs">
              {enriched.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-sm gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                    <span className="font-medium">{row.family}</span>
                  </div>
                  <span className="font-mono font-bold">{formatPercent(row.salesPct)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ventas + Margen bars */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sales bars */}
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Ventas por Familia</h3>
          <div className="space-y-4">
            {enriched.map((row, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">{row.family}</span>
                  <span className="font-mono text-sm font-bold">{formatCurrency(row.sales)}</span>
                </div>
                <div className="w-full h-3 bg-black/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${safeDivide(row.sales, maxSales) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: chColor }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Margin bars */}
        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Margen por Familia</h3>
          <div className="space-y-4">
            {enriched.map((row, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm w-32 truncate font-medium">{row.family}</span>
                <div className="flex-1 h-5 bg-black/5 rounded-full overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${row.marginPct * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: '#1e3a5f' }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold" style={{ color: row.marginPct > 0.45 ? '#fff' : '#272121' }}>
                    {formatPercent(row.marginPct)}
                  </span>
                </div>
                <span className="font-mono text-xs w-24 text-right font-bold">{formatCurrency(row.profit)}</span>
              </div>
            ))}
          </div>
          {commRate > 0 && (
            <div className="mt-4 pt-3 border-t border-[#272121]/5 flex items-center gap-2">
              <AlertCircle size={13} className="text-[#ff0024] shrink-0" />
              <span className="text-[11px] font-mono opacity-50">
                Margen incluye comisión {formatPercent(commRate)} ({formatCurrency(totalCommission)})
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ProductView ──────────────────────────────────────────────────────

type ProductRow = { product_name: string; family: string; channel: string; is_personal: number; quantity: number; sales: number; cost: number };

function aggregateProducts(rows: ProductRow[]) {
  return Object.values(
    rows.reduce<Record<string, { product_name: string; family: string; quantity: number; sales: number; cost: number }>>((acc, d) => {
      if (!acc[d.product_name]) acc[d.product_name] = { product_name: d.product_name, family: d.family, quantity: 0, sales: 0, cost: 0 };
      acc[d.product_name].quantity += d.quantity;
      acc[d.product_name].sales += d.sales;
      acc[d.product_name].cost += d.cost;
      return acc;
    }, {})
  ).sort((a, b) => b.sales - a.sales);
}

function ProductView({ data }: { data: ProductRow[] }) {
  const families = [...new Set(data.map(d => d.family))].sort((a, b) => {
    const aSales = data.filter(d => d.family === a).reduce((s, d) => s + d.sales, 0);
    const bSales = data.filter(d => d.family === b).reduce((s, d) => s + d.sales, 0);
    return bSales - aSales;
  });
  const [selectedFamily, setSelectedFamily] = useState<string>(families[0] || '');

  const familyData = data.filter(d => d.family === selectedFamily);
  const byProduct = aggregateProducts(familyData);
  const totalSales = byProduct.reduce((a, c) => a + c.sales, 0);
  const totalQty = byProduct.reduce((a, c) => a + c.quantity, 0);
  const totalCost = byProduct.reduce((a, c) => a + c.cost, 0);
  const totalMargin = totalSales - totalCost;
  const channels = [...new Set(data.map(d => d.channel))];

  const productChannelData = byProduct.map(p => {
    const entry: Record<string, string | number> = { product_name: p.product_name };
    for (const ch of channels) {
      const row = familyData.find(d => d.product_name === p.product_name && d.channel === ch);
      entry[`${ch}_sales`] = row?.sales || 0;
    }
    return entry;
  });

  const pieColors = ['#272121', '#ff0024', '#fcec0e', '#1e3a5f', '#e85d75', '#4a9eff', '#ff8c42', '#7c5cbf', '#2dd4bf', '#f472b6', '#64748b', '#0ea5e9'];
  const tooltipStyle = { backgroundColor: 'rgba(39,33,33,0.95)', border: 'none', borderRadius: '12px', color: '#d1d0d1', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' };

  return (
    <div className="space-y-8">
      {/* Family Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-widest opacity-50 font-mono font-bold mr-1">Familia</span>
        {families.map(f => (
          <button
            key={f}
            onClick={() => setSelectedFamily(f)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-mono transition-all border",
              selectedFamily === f
                ? "bg-[#272121] text-[#d1d0d1] border-[#272121] shadow-md"
                : "border-[#272121]/20 hover:border-[#272121]/50"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Ventas" value={formatCurrency(totalSales)} icon={<DollarSign size={20} />} subtitle={`${byProduct.length} productos`} />
        <KpiCard title="Cantidad" value={totalQty.toString()} icon={<Package size={20} />} subtitle="unidades" />
        <KpiCard title="Costo" value={formatCurrency(totalCost)} icon={<TrendingUp size={20} />} />
        <KpiCard title="Margen" value={formatCurrency(totalMargin)} icon={<TrendingUp size={20} />} subtitle={formatPercent(safeDivide(totalMargin, totalSales))} />
      </div>

      {/* Charts: Bar + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Ventas por Producto</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byProduct.slice(0, 10)} barSize={30} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#272121" strokeOpacity={0.05} />
                <XAxis type="number" axisLine={false} tickLine={false} fontSize={11} tick={{ fill: '#272121', opacity: 0.4 }} tickFormatter={v => formatCompact(v)} />
                <YAxis type="category" dataKey="product_name" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#272121', opacity: 0.6 }} width={160} />
                <Tooltip cursor={{ fill: '#272121', opacity: 0.05 }} contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="sales" fill="#272121" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="sales" position="right" fontSize={9} fill="#272121" opacity={0.5} formatter={(v: number) => formatCompact(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="font-bold text-xl mb-6">Distribución</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byProduct.slice(0, 8).map(p => ({ name: p.product_name, value: p.sales }))} innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {byProduct.slice(0, 8).map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-40 font-mono font-bold mb-1">
              <span className="w-2.5" />
              <span className="flex-1">Producto</span>
              <span className="w-12 text-right">Cant</span>
              <span className="w-12 text-right">%</span>
            </div>
            {byProduct.slice(0, 8).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                <span className="truncate flex-1">{p.product_name}</span>
                <span className="font-mono opacity-60 w-12 text-right">{p.quantity}</span>
                <span className="font-mono font-bold w-12 text-right">{formatPercent(safeDivide(p.sales, totalSales))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Personal vs Compartir Bar Charts */}
      {(() => {
        const personalProducts = aggregateProducts(familyData.filter(d => d.is_personal === 1));
        const compartirProducts = aggregateProducts(familyData.filter(d => d.is_personal === 0));
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
              <h3 className="font-bold text-xl mb-6">Ventas por Producto — Personal</h3>
              <div className="h-72">
                {personalProducts.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={personalProducts.slice(0, 8)} barSize={24} layout="vertical" margin={{ right: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#272121" strokeOpacity={0.05} />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="product_name" axisLine={false} tickLine={false} fontSize={9} tick={{ fill: '#272121', opacity: 0.6 }} width={130} />
                      <Tooltip cursor={{ fill: '#272121', opacity: 0.05 }} contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="sales" fill="#272121" radius={[0, 6, 6, 0]}>
                        <LabelList dataKey="sales" position="right" fontSize={9} fill="#272121" opacity={0.6} formatter={(v: number) => formatCompact(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full opacity-30 text-sm">Sin productos personales</div>
                )}
              </div>
            </div>
            <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
              <h3 className="font-bold text-xl mb-6">Ventas por Producto — Para Compartir</h3>
              <div className="h-72">
                {compartirProducts.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compartirProducts.slice(0, 8)} barSize={24} layout="vertical" margin={{ right: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#272121" strokeOpacity={0.05} />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="product_name" axisLine={false} tickLine={false} fontSize={9} tick={{ fill: '#272121', opacity: 0.6 }} width={130} />
                      <Tooltip cursor={{ fill: '#272121', opacity: 0.05 }} contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="sales" fill="#ff0024" radius={[0, 6, 6, 0]}>
                        <LabelList dataKey="sales" position="right" fontSize={9} fill="#ff0024" opacity={0.6} formatter={(v: number) => formatCompact(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full opacity-30 text-sm">Sin productos para compartir</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Ranking Table */}
      <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="font-bold text-xl mb-2">Ranking de Productos — {selectedFamily}</h3>
        <p className="text-[11px] font-mono opacity-40 mb-6">Ordenado por ventas de mayor a menor</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#272121]/10">
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold w-10">#</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Producto</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Cant</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Ventas</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Costo</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Margen</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">% Margen</th>
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold w-32">Participación</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((row, i) => {
                const margin = row.sales - row.cost;
                const marginPct = safeDivide(margin, row.sales);
                const salesPct = safeDivide(row.sales, totalSales);
                return (
                  <tr key={i} className="border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors">
                    <td className="p-3">
                      {i === 0 ? <Crown size={16} className="text-amber-500" /> :
                       i === 1 ? <Medal size={16} className="text-gray-400" /> :
                       i === 2 ? <Medal size={16} className="text-amber-700" /> :
                       <span className="font-mono text-sm opacity-40">{i + 1}</span>}
                    </td>
                    <td className="p-3 font-medium text-sm">{row.product_name}</td>
                    <td className="p-3 text-right font-mono text-xs opacity-60">{row.quantity}</td>
                    <td className="p-3 text-right font-mono text-xs font-bold">{formatCurrency(row.sales)}</td>
                    <td className="p-3 text-right font-mono text-xs opacity-60">{formatCurrency(row.cost)}</td>
                    <td className="p-3 text-right font-mono text-xs font-bold">{formatCurrency(margin)}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-[11px] font-bold">{formatPercent(marginPct)}</span>
                        <div className="w-12 h-2 bg-black/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${marginPct * 100}%`, backgroundColor: '#1e3a5f' }} />
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="w-full h-2.5 bg-black/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${salesPct * 100}%` }}
                          transition={{ duration: 0.6, delay: i * 0.05 }}
                          className="h-full rounded-full bg-[#272121]"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Channel Breakdown */}
      <div className="bg-white/50 border border-[#272121]/10 rounded-2xl p-6 backdrop-blur-sm">
        <h3 className="font-bold text-xl mb-2">Desglose por Canal — {selectedFamily}</h3>
        <p className="text-[11px] font-mono opacity-40 mb-6">Ventas de cada producto por canal</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#272121]/10">
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold">Producto</th>
                {channels.map(ch => (
                  <th key={ch} className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: CHANNEL_COLORS[ch] || '#272121' }} />
                    {ch}
                  </th>
                ))}
                <th className="p-3 text-[11px] uppercase tracking-widest opacity-40 font-mono font-bold text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {productChannelData.map((row, i) => {
                const total = channels.reduce((a, ch) => a + (Number(row[`${ch}_sales`]) || 0), 0);
                return (
                  <tr key={i} className="border-b border-[#272121]/5 hover:bg-black/[0.03] transition-colors">
                    <td className="p-3 font-medium text-sm">{row.product_name}</td>
                    {channels.map(ch => (
                      <td key={ch} className="p-3 text-right font-mono text-xs">{formatCurrency(Number(row[`${ch}_sales`]) || 0)}</td>
                    ))}
                    <td className="p-3 text-right font-mono text-xs font-bold">{formatCurrency(total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#272121]/10 font-bold bg-black/[0.02]">
                <td className="p-3">Total</td>
                {channels.map(ch => {
                  const colTotal = productChannelData.reduce((a, row) => a + (Number(row[`${ch}_sales`]) || 0), 0);
                  return <td key={ch} className="p-3 text-right font-mono text-xs">{formatCurrency(colTotal)}</td>;
                })}
                <td className="p-3 text-right font-mono text-xs">{formatCurrency(totalSales)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
