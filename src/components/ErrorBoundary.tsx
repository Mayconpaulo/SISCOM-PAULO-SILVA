import React from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
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
      return (
        <div className="min-h-screen bg-[#0B0E0D] text-[#E4EAE6] flex items-center justify-center p-6">
          <div className="metal-surface max-w-md w-full rounded-xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#2D5A43]/25 border border-[#83B499]/25 flex items-center justify-center shrink-0 text-[#83B499]">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-lg font-semibold text-[#E4EAE6]">
                  Recuperação automática disponível
                </h1>
                <p className="text-sm text-[#98A89F] leading-relaxed">
                  A visualização encontrou um estado inesperado. Clique abaixo para restaurar o SISCOM.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-[#0E1211] border border-white/10 p-3 text-xs font-mono text-[#98A89F] break-words">
              {this.state.message}
            </div>

            <button
              type="button"
              onClick={this.handleRecover}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Restaurar gerador
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
