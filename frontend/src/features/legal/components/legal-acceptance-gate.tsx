import { useState } from "react";
import axios from "axios";
import { FileText, Loader2 } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { toast } from "../../../store/use-toast-store";
import { LEGAL_UPDATED_AT, PRIVACY, TERMS } from "../legal-content";
import { LegalDocumentPage } from "./legal-document-page";

/** Documentos mudaram: pede um novo aceite antes de continuar usando. */
export function LegalAcceptanceGate() {
  const token = useAuthStore((state) => state.token);
  const refreshSession = useAuthStore((state) => state.refreshSession);
  const logout = useAuthStore((state) => state.logout);

  const [aceitou, setAceitou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [documentoAberto, setDocumentoAberto] = useState<"terms" | "privacy" | null>(null);

  if (documentoAberto) {
    return (
      <LegalDocumentPage
        document={documentoAberto === "terms" ? TERMS : PRIVACY}
        onBack={() => setDocumentoAberto(null)}
      />
    );
  }

  const confirmar = async () => {
    setSalvando(true);
    try {
      await axios.post(
        buildApiUrl("/api/legal/accept"),
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await refreshSession();
      toast.success("Tudo certo.", { message: "Obrigado por confirmar." });
    } catch {
      toast.error("Não foi possível registrar o aceite.", {
        message: "Tente novamente em instantes.",
      });
    } finally {
      setSalvando(false);
    }
  };

  const mutedClass = "text-(--ui-texto-secundario)";

  return (
    <div className="pauta-auth-screen flex min-h-dvh items-center justify-center p-4">
      <div className="pauta-auth-card w-full max-w-lg rounded-2xl border p-5 sm:rounded-3xl sm:p-8 backdrop-blur-xl">
        <div
          className={cn(
            "mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl",
            "bg-(--ui-azul-fundo) text-(--ui-azul-texto)",
          )}
        >
          <FileText className="h-7 w-7" />
        </div>

        <h1
          className={cn(
            "text-center text-xl font-black",
            "text-(--ui-texto-principal)",
          )}
        >
          Atualizamos nossos documentos
        </h1>
        <p className={cn("mt-2 text-center text-sm font-medium", mutedClass)}>
          Os Termos de Uso e a Política de Privacidade do Pauta foram atualizados em{" "}
          {LEGAL_UPDATED_AT}. Para continuar usando a plataforma, confirme que você leu e
          concorda com eles.
        </p>

        <label
          className={cn(
            "mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border p-4",
            "border-(--ui-borda) bg-(--ui-fundo-sutil)",
          )}
        >
          <input
            type="checkbox"
            checked={aceitou}
            onChange={(event) => setAceitou(event.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-600"
          />
          <span
            className={cn(
              "text-[13px] font-medium",
              "text-(--ui-texto-secundario)",
            )}
          >
            Li e concordo com os{" "}
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setDocumentoAberto("terms");
              }}
              className="font-bold text-blue-600 hover:underline cursor-pointer"
            >
              Termos de Uso
            </button>{" "}
            e com a{" "}
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setDocumentoAberto("privacy");
              }}
              className="font-bold text-blue-600 hover:underline cursor-pointer"
            >
              Política de Privacidade
            </button>
            .
          </span>
        </label>

        <button
          type="button"
          onClick={() => void confirmar()}
          disabled={!aceitou || salvando}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-black text-white transition-colors hover:bg-blue-700 cursor-pointer disabled:opacity-60"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar e continuar
        </button>

        <button
          type="button"
          onClick={logout}
          className={cn(
            "mt-3 w-full text-center text-xs font-bold hover:underline cursor-pointer",
            mutedClass,
          )}
        >
          Sair da conta
        </button>
      </div>
    </div>
  );
}
