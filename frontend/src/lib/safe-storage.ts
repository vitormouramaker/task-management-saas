/**
 * Armazenamento local à prova de limite cheio.
 *
 * O navegador do celular reserva poucos megabytes por site. Quando acaba, o
 * `setItem` lança "the quota has been exceeded" — e, antes, isso derrubava a
 * tela. Aqui a gravação simplesmente não acontece, o app continua funcionando
 * e os dados vêm do servidor.
 */
export function createSafeStorage(chavesAntigas: string[] = []): Storage {
  if (typeof window === "undefined") return memoria();

  let base: Storage;
  try {
    base = window.localStorage;
    const teste = "__pauta_teste__";
    base.setItem(teste, "1");
    base.removeItem(teste);
  } catch {
    // Aba anônima ou armazenamento bloqueado: segue sem guardar nada.
    return memoria();
  }

  // Versões antigas podem ter deixado megabytes guardados: libera o espaço.
  for (const chave of chavesAntigas) {
    try {
      base.removeItem(chave);
    } catch {
      /* não faz diferença se falhar */
    }
  }

  return {
    get length() {
      return base.length;
    },
    key: (index: number) => base.key(index),
    clear: () => base.clear(),
    getItem: (chave: string) => {
      try {
        return base.getItem(chave);
      } catch {
        return null;
      }
    },
    removeItem: (chave: string) => {
      try {
        base.removeItem(chave);
      } catch {
        /* ignora */
      }
    },
    setItem: (chave: string, valor: string) => {
      try {
        base.setItem(chave, valor);
      } catch (error) {
        console.warn(`[pauta] não deu para guardar "${chave}" no navegador:`, error);
        try {
          base.removeItem(chave);
        } catch {
          /* ignora */
        }
      }
    },
  };
}

function memoria(): Storage {
  const dados = new Map<string, string>();
  return {
    get length() {
      return dados.size;
    },
    key: (index: number) => [...dados.keys()][index] ?? null,
    clear: () => dados.clear(),
    getItem: (chave: string) => dados.get(chave) ?? null,
    removeItem: (chave: string) => void dados.delete(chave),
    setItem: (chave: string, valor: string) => void dados.set(chave, valor),
  };
}
