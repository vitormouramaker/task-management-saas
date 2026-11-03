# Testes de integração do Pauta

Sobem um Postgres próprio, servidores falsos (Stripe, Bunny, consulta de CNPJ) e o
app de verdade contra tudo isso. **Nada toca em produção nem no banco de desenvolvimento.**

```bash
node tests/run.js                # roda tudo
node tests/run.js contas lixeira # roda só esses arquivos
node tests/run.js --list         # mostra os arquivos de casos
node tests/run.js contas --log   # mostra o log do app enquanto roda
```

Na primeira execução o cluster é criado em `tests/.tmp/pgdata` (ignorado pelo git).
Se o Postgres não for encontrado, defina `PG_BIN` com a pasta `bin` da instalação.

Para rodar duas suítes ao mesmo tempo (ou em paralelo com outra pessoa):

```bash
TEST_DB=pauta_test_2 TEST_PORT_BASE=45200 node tests/run.js suporte
```

A suíte usa as portas `TEST_PORT_BASE` a `TEST_PORT_BASE + 3` (app, dublês http/https e
o receptor de eventos do conector) e `TEST_PG_PORT` (padrão 55432) para o Postgres.

## Como escrever um arquivo de casos

Cada arquivo em `tests/cases/` exporta uma função que recebe o contexto:

```js
module.exports = async function casosDeAlgo(ctx) {
  const { api, db, check, signup } = ctx;

  const dono = await signup({ email: "algo-dono@test.com", seed: 41 });
  const res = await api("GET", "/api/algo", { token: dono.token });
  check("descrição do que deveria acontecer", res.status === 200, `${res.status} ${res.data?.message}`);
};
```

Regras:

- **Cada arquivo é independente.** Crie as próprias contas com `signup` e use e-mails
  exclusivos do arquivo (ex.: `suporte-dono@test.com`), porque todos os arquivos
  compartilham o mesmo banco numa execução completa.
- `check(nome, condicao, detalhe)` é a única forma de marcar resultado. O nome
  descreve o comportamento em português, como um usuário entenderia.
- Falhou? O detalhe deve dizer o que veio (status, mensagem, JSON curto).
- Teste o comportamento pela API. Use `db` só para preparar dado difícil de criar
  pela API ou para conferir o que ficou gravado.

## O que o contexto oferece

| item | para que serve |
|---|---|
| `api(method, rota, { token, body, raw, headers })` | chama a API; devolve `{ status, data }` |
| `db` | pool do Postgres do teste |
| `check(nome, ok, detalhe)` | registra o resultado |
| `signup({ email, accountType, seed, company, extra })` | cria conta, confirma e-mail e faz login |
| `verificationTokenFor(email)` | token de confirmação de e-mail |
| `sendWebhook(tipo, objeto)` | envia evento assinado para `/api/billing/webhook` |
| `fakes.stripe` | estado da Stripe falsa (`upsertSubscription`, `setItems`, `invoices`, `customers`) |
| `fakes.objects` | arquivos guardados na Bunny falsa (`Map` caminho → Buffer) |
| `fakes.buildInvoice(sub, opts)` | monta uma fatura falsa |
| `sleep(ms)`, `waitFor(fn, timeout)` | espera por coisas assíncronas (workers, uploads) |
| `makeCpf(seed)`, `makeCnpj(seed)` | documentos válidos |
| `ctx.constants` | segredos e portas usados pelo app de teste |

## Assinatura de teste

A Stripe falsa não cria assinatura sozinha. Para simular uma conta paga:

```js
ctx.fakes.stripe.upsertSubscription("sub_teste", { customer: "cus_teste" });
ctx.fakes.stripe.setItems("sub_teste", [{ price: "price_profissional_monthly", quantity: 1 }]);
await db.query("UPDATE organizations SET stripe_customer_id = 'cus_teste', stripe_subscription_id = 'sub_teste' WHERE id = $1", [orgId]);
await ctx.sendWebhook("customer.subscription.updated", ctx.fakes.stripe.subscriptions.get("sub_teste"));
```

Os preços falsos seguem o padrão `price_<plano>_<intervalo>`, `price_<plano>_seat_<intervalo>`
e `price_storage_<intervalo>`.
