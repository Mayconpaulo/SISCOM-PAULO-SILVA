import React from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
  scopeLabel?: string;
  inline?: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Ocorreu uma instabilidade na interface.',
    };
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      const containerClass = this.props.inline
        ? 'flex-1 bg-transparent text-[#E4EAE6] flex items-center justify-center p-6'
        : 'min-h-screen bg-[#080B09] text-[#E4EAE6] flex items-center justify-center p-6';

      return (
        <div className={containerClass}>
          <div className="metal-surface max-w-md w-full rounded-xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#2D5A43]/25 border border-[#83B499]/25 flex items-center justify-center shrink-0 text-[#83B499]">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-lg font-semibold text-[#E4EAE6]">
                  {this.props.scopeLabel
                    ? `Instabilidade isolada em ${this.props.scopeLabel}`
                    : 'Recuperação automática disponível'}
                </h1>
                <p className="text-sm text-[#B8B3A6] leading-relaxed">
                  {this.props.scopeLabel
                    ? 'As demais funções do SISCOM continuam intactas. Clique abaixo para recarregar esta função.'
                    : 'A visualização encontrou um estado inesperado. Clique abaixo para restaurar o SISCOM.'}
                </p>
              </div>
            </div>

            <div className="siscom-liquid-subcard rounded-lg p-3 text-xs font-mono text-[#B8B3A6] break-words">
              {this.state.message}
            </div>

            <button
              type="button"
              onClick={this.handleRecover}
              className="siscom-btn siscom-btn-primary w-full min-h-[44px] text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              {this.props.scopeLabel ? `Recarregar ${this.props.scopeLabel}` : 'Restaurar gerador'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
