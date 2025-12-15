// src/App.jsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';

// Componentes Fixos
import Sidebar from './components/Sidebar';

// Páginas (Certifique-se que criou todos estes ficheiros)
import Dashboard from './pages/Dashboard';
import AssetList from './pages/AssetList';
import AssetForm from './pages/AssetForm';
import AssetDetail from './pages/AssetDetail';
import AuditPage from './pages/AuditPage';
import ProjectsPage from './pages/ProjectsPage'; // <--- Nova Página
import TaskBoard from './pages/TaskBoard';       // Supondo que a sua página de tarefas se chama assim
import EmployeeList from './pages/EmployeeList'; // Supondo que a sua página de equipa se chama assim
import ImportPage from './pages/ImportPage';     // Página de importação Excel

function App() {
  return (
    <div className="flex bg-gray-50 min-h-screen font-sans text-gray-900">
      
      {/* Menu Lateral Fixo */}
      <Sidebar />

      {/* Área de Conteúdo Principal (Deslocada para a direita por causa do menu) */}
      <main className="flex-1 ml-64 min-h-screen">
        <Routes>
          {/* Dashboard */}
          <Route path="/" element={<Dashboard />} />

          {/* Ativos */}
          <Route path="/assets" element={<AssetList />} />
          <Route path="/assets/new" element={<AssetForm />} />
          <Route path="/assets/edit/:id" element={<AssetForm />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/import" element={<ImportPage />} />

          {/* Auditoria */}
          <Route path="/audit" element={<AuditPage />} />

          {/* Projetos & Tarefas */}
          <Route path="/projects" element={<ProjectsPage />} /> {/* <--- Rota Nova */}
          <Route path="/tasks" element={<TaskBoard />} />

          {/* Pessoas */}
          <Route path="/employees" element={<EmployeeList />} />
          
          {/* Fallback para rota não encontrada */}
          <Route path="*" element={<div className="p-10 text-center text-gray-500">Página não encontrada (404)</div>} />
        </Routes>
      </main>
      
    </div>
  );
}

export default App;