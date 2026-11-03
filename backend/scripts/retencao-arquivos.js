/**
 * Mostra o que a retenção faria hoje — e só apaga se você mandar.
 *
 *   node scripts/retencao-arquivos.js              simulação (não muda nada)
 *   node scripts/retencao-arquivos.js --avisar     envia os avisos pendentes
 *   node scripts/retencao-arquivos.js --aplicar    remove os arquivos vencidos
 *
 * A remoção exige, além do --aplicar, a variável RETENCAO_REMOVER_ARQUIVOS=1
 * no ambiente. São duas travas de propósito: apagar arquivo de cliente não
 * pode depender de um comando digitado errado.
 */
require("../src/config/env");
const { postgres } = require("../src/server/connect");
const retencao = require("../src/services/retencao.service");

function formatarData(valor) {
  return valor ? new Date(valor).toLocaleDateString("pt-BR") : "—";
}

async function principal() {
  const avisar = process.argv.includes("--avisar");
  const aplicar = process.argv.includes("--aplicar");

  const previsao = await retencao.simular();

  console.log("— Retenção de arquivos após o cancelamento —");
  console.log(`  prazo               ${previsao.diasDeRetencao} dias`);
  console.log(`  avisos nos dias     ${previsao.marcosDeAviso.join(", ")}`);
  console.log(`  remoção             ${previsao.remocaoLigada ? "ligada" : "DESLIGADA (RETENCAO_REMOVER_ARQUIVOS)"}`);
  console.log(`  contas encerradas   ${previsao.contas.length}`);

  if (previsao.contas.length > 0) {
    console.log("\n  conta                          encerrada em   dias   arquivos      GB   situação");
    for (const conta of previsao.contas) {
      const estado = conta.arquivosRemovidosEm
        ? `removidos em ${formatarData(conta.arquivosRemovidosEm)}`
        : conta.dias >= previsao.diasDeRetencao
          ? "vencida"
          : `faltam ${conta.diasRestantes} dias`;
      console.log(
        `  ${String(conta.nome || conta.id).slice(0, 28).padEnd(30)} ${formatarData(conta.encerradaEm).padEnd(14)} ${String(conta.dias).padStart(4)} ${String(conta.arquivos).padStart(10)} ${String(conta.gb).padStart(7)}   ${estado}`,
      );
    }
  }

  console.log(`\n  avisos a enviar     ${previsao.aAvisar.length}`);
  console.log(`  contas vencidas     ${previsao.aRemover.length} (${previsao.gbARemover} GB)`);

  if (avisar) {
    const enviados = await retencao.avisar({});
    console.log(`\n  avisos enviados agora: ${enviados.length}`);
  }

  if (aplicar) {
    const resultado = await retencao.removerArquivosVencidos({ aplicar: true });
    if (!resultado.aplicado) {
      console.log("\n  NADA foi removido: falta RETENCAO_REMOVER_ARQUIVOS=1 no ambiente.");
    } else {
      console.log(
        `\n  removidos: ${resultado.removidas} conta(s), ${resultado.arquivos} arquivo(s), ${resultado.gb} GB`,
      );
    }
  } else if (previsao.aRemover.length > 0) {
    console.log("\n  (simulação: nada foi apagado. Use --aplicar quando quiser valer.)");
  }

  await postgres.end();
}

principal().catch((erro) => {
  console.error("falhou:", erro.message);
  process.exit(1);
});
