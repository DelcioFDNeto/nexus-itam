// src/components/ErrorBoundary.jsx
import React from 'react';

/**
 * Antes, qualquer excecao de render derrubava o app inteiro para uma tela branca
 * sem nenhuma pista. Aqui a falha fica contida e o usuario consegue se recuperar.
 *
 * `resetKey`: quando muda (ex.: a rota atual), o erro e descartado. As rotas
 * reaproveitam a mesma instancia do boundary; sem isto, depois de uma falha,
 * navegar pelo menu continuava exibindo "Algo quebrou nesta tela".
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

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center bg-slate-50 dark:bg-[#09090b]"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-400">
          Erro inesperado
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-[#fafafa]">
          Algo quebrou nesta tela
        </h1>
        <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-zinc-400">
          O restante do sistema continua funcionando. Tente novamente ou volte ao painel.
        </p>
        <pre className="mt-5 max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-4 py-3 text-left font-mono text-xs text-slate-700 dark:text-zinc-300">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-brand-fg shadow-sm transition-colors hover:bg-brand-dark active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#09090b]"
          >
            Tentar novamente
          </button>
          <a
            href="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-zinc-200 transition-colors hover:bg-slate-50 dark:hover:bg-[#18181b] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#09090b]"
          >
            Ir para o painel
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
