import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { buildApiUrl } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useAuthStore } from "../../../store/use-auth-store";
import { useTaskStore } from "../../../store/use-task-store";

export const SAMPLE_PROJECT_NAME = "Comece por aqui";
export const START_TOUR_EVENT = "pauta:start-tour";
/** O tour pede ao app para abrir/fechar o menu lateral no celular. */
export const TOUR_MOBILE_NAV_EVENT = "pauta:tour-menu-mobile";

interface TourStep {
  /** data-tour do elemento destacado; sem alvo, o balão fica no centro. */
  target?: string;
  /** Passos que só fazem sentido dentro de um projeto aberto. */
  precisaDoProjeto?: boolean;
  /** Passos que destacam o menu lateral (escondido no celular). */
  precisaDoMenu?: boolean;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: "Bem-vindo ao Pauta!",
    body: "Em um minuto mostramos o essencial. Criamos um projeto de exemplo, \"Comece por aqui\", para você explorar à vontade.",
  },
  {
    target: "workspaces",
    precisaDoMenu: true,
    title: "Espaços de trabalho e projetos",
    body: "Organize o trabalho em espaços de trabalho (uma área, cliente ou time) e, dentro deles, em projetos. É aqui que você cria e encontra tudo.",
  },
  {
    target: "board",
    precisaDoProjeto: true,
    title: "Quadro de cards",
    body: "Cada card é um pedaço de trabalho. Arraste entre as colunas conforme o trabalho anda e clique para ver detalhes, checklist, anexos e comentários.",
  },
  {
    target: "add-task",
    precisaDoProjeto: true,
    title: "Criar cards",
    body: "Use este botão para adicionar cards com prazo, responsáveis, prioridade e etiquetas.",
  },
  {
    target: "view-tabs",
    precisaDoProjeto: true,
    title: "Outras formas de ver",
    body: "Veja o mesmo projeto em Lista, Tabela, Timeline ou Calendário, conforme o seu plano.",
  },
  {
    target: "nav",
    precisaDoMenu: true,
    title: "Atalhos do dia a dia",
    body: "Este menu leva a tudo: visão geral, prazos, equipe, relatórios, ajuda e o que foi para a lixeira. Ele cresce junto com o seu plano.",
  },
  {
    target: "welcome-card",
    precisaDoProjeto: true,
    title: "Tudo pronto!",
    body: "Comece por este card: abra o \"Bem-vindo ao Pauta!\" e siga o checklist. Se precisar, fale com a gente pelo menu Suporte, onde também dá para rever este tour.",
  },
];

const PADDING = 8;

/** Tour guiado do primeiro acesso (e sob demanda pelo evento START_TOUR_EVENT). */
export function ProductTour() {
  const tourPending = useAuthStore((state) => state.user?.tourPending);
  const token = useAuthStore((state) => state.token);
  const setActiveList = useTaskStore((state) => state.setActiveList);
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const medir = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  /** Abre o projeto de exemplo. Devolve false enquanto os projetos nao chegaram. */
  const openSampleProject = useCallback(() => {
    const listas = useTaskStore.getState().graph.lists;
    const sample = Object.values(listas).find((list) => list.name === SAMPLE_PROJECT_NAME);
    const anyList = sample ?? Object.values(listas)[0];
    if (!anyList) return false;
    setActiveList(anyList.id);
    return true;
  }, [setActiveList]);

  // Primeiro acesso: começa sozinho depois que o app carregou.
  useEffect(() => {
    if (!tourPending || step !== null) return;
    const timer = window.setTimeout(() => setStep(0), 800);
    return () => window.clearTimeout(timer);
  }, [tourPending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const start = () => setStep(0);
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const current = step !== null ? STEPS[step] : null;

  // Passos de dentro do projeto so fazem sentido com o projeto na tela: abre
  // antes de medir o destaque e insiste enquanto os projetos nao carregaram.
  useEffect(() => {
    if (!current?.precisaDoProjeto) return;
    if (openSampleProject()) return;
    const tentativa = window.setInterval(() => {
      if (openSampleProject()) window.clearInterval(tentativa);
    }, 400);
    const desiste = window.setTimeout(() => window.clearInterval(tentativa), 8000);
    return () => {
      window.clearInterval(tentativa);
      window.clearTimeout(desiste);
    };
  }, [current?.precisaDoProjeto, step, openSampleProject]);

  // No celular o menu lateral vive fechado: abre só nos passos que falam dele.
  useEffect(() => {
    if (!isMobile || step === null) return;
    const abrir = Boolean(current?.precisaDoMenu);
    window.dispatchEvent(new CustomEvent(TOUR_MOBILE_NAV_EVENT, { detail: { abrir } }));
    return () => {
      if (abrir) window.dispatchEvent(new CustomEvent(TOUR_MOBILE_NAV_EVENT, { detail: { abrir: false } }));
    };
  }, [isMobile, step, current?.precisaDoMenu]);

  // Acompanha a posição do elemento destacado (rolagem, redimensionamento).
  useLayoutEffect(() => {
    if (!current?.target) {
      setRect(null);
      return;
    }
    let jaRolou = false;
    const measure = () => {
      const element = document.querySelector(`[data-tour="${current.target}"]`);
      const box = element?.getBoundingClientRect();
      const visivel = Boolean(box && box.width > 0 && box.height > 0);
      // No celular o destaque costuma estar fora da tela: leva ele para o meio.
      if (visivel && !jaRolou && element) {
        jaRolou = true;
        element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
      setRect(visivel ? (box as DOMRect) : null);
    };
    measure();
    const interval = window.setInterval(measure, 300);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
    };
  }, [current?.target]);

  const finish = () => {
    setStep(null);
    if (useAuthStore.getState().user?.tourPending) {
      useAuthStore.setState((state) => ({
        user: state.user ? { ...state.user, tourPending: false } : state.user,
      }));
      void axios
        .post(buildApiUrl("/api/onboarding/tour/complete"), {}, { headers: { Authorization: `Bearer ${token}` } })
        .catch(() => null);
    }
  };

  useEffect(() => {
    if (step === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight" && step < STEPS.length - 1) setStep(step + 1);
      if (event.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === null || !current) return null;

  const isLast = step === STEPS.length - 1;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const cardWidth = Math.min(340, viewportW - 32);

  let cardStyle: React.CSSProperties;

  if (isMobile) {
    // No celular o balao e uma faixa presa em uma das bordas, com a largura da
    // tela. Fica do lado oposto ao destaque para nao cobrir o que ele mostra.
    const destaqueEmBaixo = rect ? rect.top + rect.height / 2 > viewportH / 2 : false;
    cardStyle = {
      left: 12,
      right: 12,
      width: "auto",
      maxWidth: "none",
      ...(destaqueEmBaixo ? { top: 12 } : { bottom: 12 }),
    };
  } else {
    // No computador o balao fica ao lado do destaque: abaixo se couber, senao
    // acima, senao a direita.
    cardStyle = {
      left: (viewportW - cardWidth) / 2,
      top: Math.max(16, viewportH / 2 - 120),
      width: cardWidth,
    };
    if (rect) {
      const below = rect.bottom + PADDING + 12;
      const above = rect.top - PADDING - 12;
      const left = Math.min(Math.max(16, rect.left), viewportW - cardWidth - 16);
      if (below + 220 < viewportH) cardStyle = { left, top: below, width: cardWidth };
      else if (above - 220 > 0) cardStyle = { left, top: above - 200, width: cardWidth };
      else
        cardStyle = {
          left: Math.min(rect.right + 16, viewportW - cardWidth - 16),
          top: Math.min(Math.max(16, rect.top), viewportH - 240),
          width: cardWidth,
        };
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label="Tour do Pauta">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-blue-500 transition-all duration-300"
          style={{
            left: rect.left - PADDING,
            top: rect.top - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        className={cn(
          "absolute rounded-2xl border p-5 shadow-2xl",
          "border-(--ui-borda) bg-(--ui-superficie) text-(--ui-texto-principal)",
        )}
        style={cardStyle}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {step === 0 && <Sparkles className="h-4 w-4 text-blue-600" />}
            <h3 className="text-base font-black">{current.title}</h3>
          </div>
          <button type="button" onClick={finish} aria-label="Fechar tour" className="cursor-pointer opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className={cn("text-sm font-medium leading-relaxed", "text-(--ui-texto-secundario)")}>{current.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex gap-1">
            {STEPS.map((_, index) => (
              <span key={index} className={cn("h-1.5 rounded-full transition-all", index === step ? "w-4 bg-blue-600" : "w-1.5 bg-slate-300")} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step === 0 ? (
              <button type="button" onClick={finish} className="h-9 rounded-xl px-3 text-xs font-bold opacity-70 hover:opacity-100 cursor-pointer">
                Pular
              </button>
            ) : (
              <button type="button" onClick={() => setStep(step - 1)} aria-label="Voltar" className="grid h-9 w-9 place-items-center rounded-xl cursor-pointer hover:bg-black/5">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish() : setStep(step + 1))}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700 cursor-pointer"
            >
              {isLast ? "Começar" : step === 0 ? "Mostrar" : "Próximo"}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
