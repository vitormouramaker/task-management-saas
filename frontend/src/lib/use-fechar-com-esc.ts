import { useEffect } from "react";

/**
 * Fecha a janela quando a pessoa aperta Esc — o reflexo de quem usa teclado.
 *
 * Só o modal mais recente responde: cada um para a propagação, então o Esc
 * fecha um de cada vez quando há janelas sobrepostas.
 */
export function useFecharComEsc(aberto: boolean, aoFechar: () => void) {
  useEffect(() => {
    if (!aberto) return;

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      aoFechar();
    };

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);
}
