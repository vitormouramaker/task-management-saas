import { ArrowLeft } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  COMPANY,
  LEGAL_UPDATED_AT,
  LEGAL_VERSION,
  type LegalDocument,
} from "../legal-content";

interface LegalDocumentPageProps {
  document: LegalDocument;
  onBack?: () => void;
}

/** Página de leitura de Termos de Uso ou Política de Privacidade. */
export function LegalDocumentPage({ document, onBack }: LegalDocumentPageProps) {

  const mutedClass = "text-(--ui-texto-secundario)";
  const titleClass = "text-(--ui-texto-principal)";

  return (
    <div
      className={cn(
        "min-h-dvh w-full overflow-auto px-4 py-10 sm:px-8",
        "bg-(--ui-fundo-sutil)",
      )}
    >
      <div className="mx-auto w-full max-w-3xl">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        )}

        <h1 className={cn("text-2xl font-black sm:text-3xl", titleClass)}>
          {document.title} · {COMPANY.brand}
        </h1>
        <p className={cn("mt-2 text-sm font-medium", mutedClass)}>{document.summary}</p>
        <p className={cn("mt-1 text-xs font-bold", mutedClass)}>
          Versão {LEGAL_VERSION} · atualizado em {LEGAL_UPDATED_AT} ·{" "}
          {COMPANY.legalName}, CNPJ {COMPANY.cnpj}
        </p>

        <div className="mt-8 space-y-8 pb-16">
          {document.sections.map((section) => (
            <section key={section.title}>
              <h2 className={cn("text-base font-black", titleClass)}>{section.title}</h2>

              {section.paragraphs?.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className={cn("mt-2 text-sm font-medium leading-relaxed", mutedClass)}
                >
                  {paragraph}
                </p>
              ))}

              {section.bullets && (
                <ul className="mt-3 space-y-1.5">
                  {section.bullets.map((bullet) => (
                    <li
                      key={bullet.slice(0, 40)}
                      className={cn("flex gap-2 text-sm font-medium leading-relaxed", mutedClass)}
                    >
                      <span className="text-blue-600">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
