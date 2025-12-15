// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Contexto de Autenticação
import { AuthProvider } from './contexts/AuthContext';

// Estrutura Base
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';

// Páginas do Sistema
import Dashboard from './pages/Dashboard';
import AssetList from './pages/AssetList';
import AssetForm from './pages/AssetForm';
import AssetDetail from './pages/AssetDetail';
import ImportData from './pages/ImportData';
import EmployeeManager from './pages/EmployeeManager';
import AuditPage from './pages/AuditPage';
import LicenseManager from './pages/LicenseManager';
import TaskManager from './pages/TaskManager';
import ProjectsPage from './pages/ProjectsPage';
import ServiceManager from './pages/ServiceManager';


function App() {
  return (
    <AuthProvider>
      <Router>
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

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;