import { Component, type ErrorInfo, type ReactNode } from "react";

import { registrarErro } from "../lib/monitoring";

interface ErrorBoundaryState {
  erro: Error | null;
}

/**
 * Rede de proteção da interface: um erro em qualquer tela mostra um aviso com
 * botão de recarregar, em vez de deixar a página em branco.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { erro: null };

  static getDerivedStateFromError(erro: Error): ErrorBoundaryState {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("[pauta] erro na interface:", erro, info.componentStack);
    registrarErro(erro, { componentStack: info.componentStack });
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div style={{ maxWidth: 420, textAlign: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>Algo deu errado por aqui</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>
            A tela não conseguiu carregar. Recarregue a página; se continuar, fale com a gente pelo suporte.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, height: 40, padding: "0 20px", borderRadius: 12, border: "none", background: "#2563eb", color: "#fff", fontWeight: 800, cursor: "pointer" }}
          >
            Recarregar
          </button>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 16, wordBreak: "break-word" }}>{erro.message}</p>
        </div>
      </div>
    );
  }
}
