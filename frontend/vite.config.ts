import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ambientes fechados (homologacao) saem do build pedindo para nao serem
// indexados, direto no HTML -- sem depender de JavaScript.
function noindexEmHomologacao(ambiente: string | undefined) {
  return {
    name: "noindex-homologacao",
    transformIndexHtml(html: string) {
      if (ambiente !== "homologacao") return html;
      return html.replace(
        "</head>",
        '<meta name="robots" content="noindex, nofollow" /></head>',
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // O .env.local so chega aqui pelo loadEnv.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss(), noindexEmHomologacao(env.VITE_AMBIENTE)],
    build: {
      rollupOptions: {
        output: {
          // Separa as bibliotecas do código do Pauta: elas quase não mudam,
          // então o navegador reaproveita o que já baixou a cada atualização.
          manualChunks: {
            "vendor-react": ["react", "react-dom"],
            "vendor-dados": ["@tanstack/react-query", "zustand", "axios"],
            "vendor-arrastar": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
            "vendor-formulario": ["react-hook-form", "@hookform/resolvers", "zod"],
            "vendor-notificacao": ["firebase/app", "firebase/messaging"],
            "vendor-monitoramento": ["@sentry/react"],
            "vendor-texto": ["marked", "date-fns"],
          },
        },
      },
    },
  };
})
