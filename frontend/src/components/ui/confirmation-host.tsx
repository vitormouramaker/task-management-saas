import { useConfirmStore } from "../../store/use-confirm-store";
import { ConfirmationModal } from "./confirmation-modal";

/**
 * Mostra a confirmação pedida por `confirmar()`. Fica montado uma vez só, ao
 * lado dos avisos, para qualquer tela poder pedir uma confirmação.
 */
export function ConfirmationHost() {
  const pedido = useConfirmStore((state) => state.pedido);
  const responder = useConfirmStore((state) => state.responder);

  if (!pedido) return null;

  return (
    <ConfirmationModal
      key={pedido.id}
      isOpen
      title={pedido.title}
      message={pedido.message}
      confirmLabel={pedido.confirmLabel}
      cancelLabel={pedido.cancelLabel}
      pendingLabel={pedido.pendingLabel}
      variant={pedido.variant}
      onConfirm={() => responder(true)}
      onClose={() => responder(false)}
    />
  );
}
