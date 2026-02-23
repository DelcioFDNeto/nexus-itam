// src/App.jsx
import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Contexto de Autenticação
import { AuthProvider } from './contexts/AuthContext';

// Estrutura Base (Carregamento Imediato)
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';

// Componente de Fallback (Loading State)
const PageLoader = () => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-[#F4F4F5]">
    <div className="w-12 h-12 border-4 border-gray-200 border-t-black rounded-full animate-spin"></div>
    <p className="mt-4 text-sm font-bold text-gray-500 tracking-widest uppercase animate-pulse">Carregando...</p>
  </div>
);

// Páginas do Sistema (Lazy Loading)
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

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
          
          {/* Rota Pública (Login) */}
          <Route path="/" element={<Login />} />

          {/* --- ROTAS PROTEGIDAS --- */}
          
          {/* Dashboard Geral */}
          <Route path="/dashboard" element={
            <PrivateRoute><Layout><Dashboard /></Layout></PrivateRoute>
          } />

          {/* Gestão de Ativos (Hardware) */}
          <Route path="/assets" element={
            <PrivateRoute><Layout><AssetList /></Layout></PrivateRoute>
          } />
          <Route path="/assets/new" element={
            <PrivateRoute><Layout><AssetForm /></Layout></PrivateRoute>
          } />
          <Route path="/assets/edit/:id" element={
            <PrivateRoute><Layout><AssetForm /></Layout></PrivateRoute>
          } />
          <Route path="/assets/:id" element={
            <PrivateRoute><Layout><AssetDetail /></Layout></PrivateRoute>
          } />

          {/* Ferramentas de Gestão */}
          
          {/* --- ROTA NOVA ADICIONADA AQUI --- */}
          <Route path="/projects" element={
            <PrivateRoute><Layout><ProjectsPage /></Layout></PrivateRoute>
          } />

          <Route path="/projects/:id" element={
            <PrivateRoute><Layout><ProjectDetails /></Layout></PrivateRoute>
          } />

          <Route path="/tasks" element={
            <PrivateRoute><Layout><TaskManager /></Layout></PrivateRoute>
          } />
          
          <Route path="/licenses" element={
            <PrivateRoute><Layout><LicenseManager /></Layout></PrivateRoute>
          } />

          <Route path="/services" element={
            <PrivateRoute><Layout><ServiceManager /></Layout></PrivateRoute>
          } />

          <Route path="/employees" element={
            <PrivateRoute><Layout><EmployeeManager /></Layout></PrivateRoute>
          } />

          <Route path="/audit" element={
            <PrivateRoute><Layout><AuditPage /></Layout></PrivateRoute>
          } />

          <Route path="/import" element={
            <PrivateRoute><Layout><ImportData /></Layout></PrivateRoute>
          } />

          <Route path="/settings" element={
            <PrivateRoute><Layout><SettingsPage /></Layout></PrivateRoute>
          } />

        </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;