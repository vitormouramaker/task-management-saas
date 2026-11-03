import { useMemo, useState } from "react";
import { ChevronDown, Headphones, HelpCircle, Search } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useSupportPanel } from "../../support/support-api";
import { HELP_SECTIONS, type HelpArticle } from "../help-content";

/** Central de ajuda: perguntas e respostas com busca. */
export function HelpPage() {
  const abrirSuporte = useSupportPanel((state) => state.open);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(HELP_SECTIONS[0]?.articles[0]?.id ?? null);

  const termo = busca.trim().toLowerCase();
  const secoes = useMemo(() => {
    if (!termo) return HELP_SECTIONS;
    const combina = (artigo: HelpArticle) =>
      [artigo.question, ...artigo.answer, ...(artigo.keywords || [])]
        .join(" ")
        .toLowerCase()
        .includes(termo);

    return HELP_SECTIONS.map((secao) => ({ ...secao, articles: secao.articles.filter(combina) })).filter(
      (secao) => secao.articles.length > 0,
    );
  }, [termo]);

  const muted = "text-(--ui-texto-secundario)";
  const titulo = "text-(--ui-texto-principal)";
  const borda = "border-(--ui-borda)";
  const cartao = cn("rounded-2xl border", borda, "bg-(--ui-superficie)");

  return (
    <div className="flex h-full w-full flex-col animate-in fade-in duration-300">
      <div className="pauta-scroll-safe min-w-0 flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="w-full">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600/10 text-blue-600">
              <HelpCircle className="h-5 w-5" />
            </span>
            <div>
              <h1 className={cn("text-2xl font-black tracking-tight", titulo)}>Central de ajuda</h1>
              <p className={cn("mt-1 text-sm font-medium", muted)}>
                As dúvidas mais comuns de quem usa o Pauta, em ordem de primeiros passos até cobrança.
              </p>
            </div>
          </div>

          <div className="relative mb-5">
            <Search className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", muted)} />
            <input aria-label="Buscar na ajuda (ex.: prazo, anexo, cancelar)"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar na ajuda (ex.: prazo, anexo, cancelar)"
              className={cn(
                "h-11 w-full rounded-xl border pl-9 pr-3 text-sm font-medium outline-none focus:border-blue-500",
                "border-(--ui-borda) bg-(--ui-superficie-suave) text-(--ui-texto-principal)",
              )}
            />
          </div>

          {secoes.length === 0 ? (
            <div className={cn(cartao, "p-6 text-center")}>
              <p className={cn("text-sm font-bold", titulo)}>Nada encontrado para "{busca}".</p>
              <button
                type="button"
                onClick={() => abrirSuporte()}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
              >
                <Headphones className="h-4 w-4" />
                Falar com o suporte
              </button>
            </div>
          ) : (
            <div className="space-y-5 xl:columns-2 xl:gap-5 xl:space-y-0">
              {secoes.map((secao) => (
                <section key={secao.id} className="mb-5 break-inside-avoid">
                  <h2 className={cn("mb-2 text-xs font-black uppercase tracking-wide", muted)}>{secao.title}</h2>
                  <div className={cn(cartao, "divide-y", "divide-(--ui-borda-suave)")}>
                    {secao.articles.map((artigo) => {
                      const expandida = aberta === artigo.id || Boolean(termo);
                      return (
                        <div key={artigo.id}>
                          <button
                            type="button"
                            onClick={() => setAberta(aberta === artigo.id ? null : artigo.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer"
                          >
                            <span className={cn("min-w-0 flex-1 text-sm font-bold", titulo)}>{artigo.question}</span>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", muted, expandida && "rotate-180")} />
                          </button>
                          {expandida && (
                            <div className="space-y-2 px-4 pb-4">
                              {artigo.answer.map((paragrafo, index) => (
                                <p key={index} className={cn("text-sm font-medium leading-relaxed", muted)}>
                                  {paragrafo}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className={cn(cartao, "mt-6 flex flex-wrap items-center justify-between gap-3 p-5")}>
            <div>
              <p className={cn("text-sm font-bold", titulo)}>Ainda com dúvida?</p>
              <p className={cn("text-sm font-medium", muted)}>
                Fale com a gente pelo chat; o prazo de resposta depende do seu plano.
              </p>
            </div>
            <button
              type="button"
              onClick={() => abrirSuporte()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 cursor-pointer"
            >
              <Headphones className="h-4 w-4" />
              Abrir o suporte
            </button>
          </div>

          <p className={cn("mt-4 text-center text-xs font-medium", muted)}>
            <a href="/termos" target="_blank" rel="noreferrer" className="font-bold text-blue-600 hover:underline">
              Termos de Uso
            </a>{" "}
            ·{" "}
            <a href="/privacidade" target="_blank" rel="noreferrer" className="font-bold text-blue-600 hover:underline">
              Política de Privacidade
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
