import { create } from "zustand";

/**
 * Confirmação de ação em um modal do próprio Pauta, no lugar da caixa cinza
 * do navegador.
 *
 * Uso, igualzinho ao confirm() que existia antes:
 *
 *   if (!(await confirmar({ title: "Excluir projeto?", message: "..." }))) return;
 */

export interface ConfirmInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  variant?: "danger" | "warning" | "info";
}

interface ConfirmRequest extends ConfirmInput {
  id: number;
  responder: (resposta: boolean) => void;
}

interface ConfirmStore {
  pedido: ConfirmRequest | null;
  perguntar: (input: ConfirmInput) => Promise<boolean>;
  responder: (resposta: boolean) => void;
}

let proximoId = 0;

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  pedido: null,

  perguntar: (input) =>
    new Promise<boolean>((resolve) => {
      // Um pedido por vez: se já houver um aberto, o anterior é cancelado.
      const anterior = get().pedido;
      if (anterior) anterior.responder(false);

      proximoId += 1;
      set({ pedido: { ...input, id: proximoId, responder: resolve } });
    }),

  responder: (resposta) => {
    const pedido = get().pedido;
    if (!pedido) return;
    set({ pedido: null });
    pedido.responder(resposta);
  },
}));

/** Atalho para usar em qualquer lugar, inclusive fora de componentes. */
export function confirmar(input: ConfirmInput) {
  return useConfirmStore.getState().perguntar(input);
}
