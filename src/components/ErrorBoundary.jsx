// src/components/ErrorBoundary.jsx
import React from 'react';

/**
 * Antes, qualquer excecao de render derrubava o app inteiro para uma tela branca
 * sem nenhuma pista. Aqui a falha fica contida e o usuario consegue se recuperar.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Falha de renderizacao:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-500">Erro inesperado</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          Algo quebrou nesta tela
        </h1>
        <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
          O restante do sistema continua funcionando. Tente novamente ou volte ao painel.
        </p>
        <pre className="mt-5 max-w-full overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800/70 px-4 py-3 text-left text-[11px] text-slate-600 dark:text-slate-300">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={this.handleReset}
            className="rounded-xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800"
          >
            Tentar novamente
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Ir para o painel
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
