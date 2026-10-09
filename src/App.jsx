// src/App.jsx
import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';

// Contextos
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';

// Estrutura base (carregamento imediato)
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import PWAToast from './components/PWAToast';

const PageLoader = () => (
  <div className="flex min-h-[50vh] flex-col items-center justify-center">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
    <p className="mt-4 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Carregando</p>
  </div>
);

const NotFound = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Erro 404</p>
    <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white">
      Página não encontrada
    </h1>
    <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
      O endereço acessado não existe ou foi movido.
    </p>
    <Link
      to="/dashboard"
      className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
    >
      Voltar ao painel
    </Link>
  </div>
);

// Paginas do sistema (lazy loading)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AssetList = lazy(() => import('./pages/AssetList'));
const AssetForm = lazy(() => import('./pages/AssetForm'));
const AssetDetail = lazy(() => import('./pages/AssetDetail'));
const ImportData = lazy(() => import('./pages/ImportData'));
const EmployeeManager = lazy(() => import('./pages/EmployeeManager'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const LicenseManager = lazy(() => import('./pages/LicenseManager'));
const TaskManager = lazy(() => import('./pages/TaskManager'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetails = lazy(() => import('./pages/ProjectDetails'));
const ServiceManager = lazy(() => import('./pages/ServiceManager'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AgentManager = lazy(() => import('./pages/AgentManager'));
const Register = lazy(() => import('./pages/Register'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const UserManager = lazy(() => import('./pages/UserManager'));
const TenantManager = lazy(() => import('./pages/TenantManager'));
const NexusUserManager = lazy(() => import('./pages/NexusUserManager'));
const NexusPlansManager = lazy(() => import('./pages/NexusPlansManager'));
const TermsPage = lazy(() => import('./pages/TermsPage'));

/**
 * Rota autenticada. `capability` e `masterOnly` sao a mesma linguagem usada em
 * firestore.rules — mudou a permissao de uma tela, muda nos dois lugares.
 * `feature` exige o recurso no plano da empresa (utils/entitlements.js).
 */
const AppRoute = ({ element, capability, masterOnly, feature }) => {
  const { pathname } = useLocation();
  return (
    <PrivateRoute capability={capability} masterOnly={masterOnly} feature={feature}>
      <Layout>
        {/* resetKey: um erro numa tela nao "persegue" o usuario pelas proximas rotas */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<PageLoader />}>{element}</Suspense>
        </ErrorBoundary>
      </Layout>
    </PrivateRoute>
  );
};

const PublicRoute = ({ element }) => (
  <Suspense fallback={<PageLoader />}>{element}</Suspense>
);

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <Router>
            <PWAToast />
            <Routes>
              {/* --- Rotas publicas --- */}
              <Route path="/" element={<Login />} />
              <Route path="/register" element={<PublicRoute element={<Register />} />} />
              {/* Link enviado pelo administrador: cria a conta e entra na empresa */}
              <Route path="/convite/:inviteId" element={<PublicRoute element={<AcceptInvite />} />} />

              {/* --- Operacao de ativos --- */}
              <Route path="/dashboard" element={<AppRoute element={<Dashboard />} capability="assets:read" />} />
              <Route path="/assets" element={<AppRoute element={<AssetList />} capability="assets:read" />} />
              <Route path="/assets/new" element={<AppRoute element={<AssetForm />} capability="assets:write" />} />
              <Route path="/assets/edit/:id" element={<AppRoute element={<AssetForm />} capability="assets:write" />} />
              <Route path="/assets/:id" element={<AppRoute element={<AssetDetail />} capability="assets:read" />} />

              {/* --- Gestao --- */}
              <Route path="/projects" element={<AppRoute element={<ProjectsPage />} capability="projects:write" feature="projects" />} />
              <Route path="/projects/:id" element={<AppRoute element={<ProjectDetails />} capability="projects:write" feature="projects" />} />
              <Route path="/tasks" element={<AppRoute element={<TaskManager />} capability="tasks:write" feature="projects" />} />
              <Route path="/licenses" element={<AppRoute element={<LicenseManager />} capability="licenses:write" feature="licenses" />} />
              <Route path="/services" element={<AppRoute element={<ServiceManager />} capability="contracts:write" feature="contracts" />} />
              <Route path="/employees" element={<AppRoute element={<EmployeeManager />} capability="employees:write" />} />
              <Route path="/audit" element={<AppRoute element={<AuditPage />} capability="audit:run" feature="audit" />} />
              {/* Termos: responsabilidade, devolucao e transferencia (o QR impresso abre /termos/:id) */}
              <Route path="/termos" element={<AppRoute element={<TermsPage />} capability="terms:read" />} />
              <Route path="/termos/:termId" element={<AppRoute element={<TermsPage />} capability="terms:read" />} />

              {/* --- Administracao do inquilino --- */}
              <Route path="/agent" element={<AppRoute element={<AgentManager />} capability="agent:manage" feature="agent" />} />
              <Route path="/import" element={<AppRoute element={<ImportData />} capability="assets:import" feature="import" />} />
              <Route path="/settings" element={<AppRoute element={<SettingsPage />} capability="settings:read" />} />
              <Route path="/users" element={<AppRoute element={<UserManager />} capability="users:manage" />} />

              {/* --- Console Nexus Master --- */}
              <Route path="/admin/tenants" element={<AppRoute element={<TenantManager />} masterOnly />} />
              <Route path="/admin/users" element={<AppRoute element={<NexusUserManager />} masterOnly />} />
              <Route path="/admin/plans" element={<AppRoute element={<NexusPlansManager />} masterOnly />} />

              {/* --- Fallbacks --- */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<AppRoute element={<NotFound />} />} />
            </Routes>
          </Router>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
