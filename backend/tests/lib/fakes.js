const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Serviços externos falsos para os testes: Stripe, Bunny (API de storage e CDN)
 * e a consulta de CNPJ. Nada sai da máquina.
 *
 * - servidor http: Stripe + API da Bunny + BrasilAPI
 * - servidor https: a "pull zone" da Bunny, porque as URLs públicas são https
 */

const TMP_DIR = path.join(__dirname, "..", ".tmp");

function ensureCertificate() {
  const keyPath = path.join(TMP_DIR, "fake-key.pem");
  const certPath = path.join(TMP_DIR, "fake-cert.pem");
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const result = spawnSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650",
        "-keyout", keyPath, "-out", certPath,
        "-subj", "/CN=127.0.0.1",
        "-addext", "subjectAltName=IP:127.0.0.1",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`não foi possível gerar o certificado de teste: ${result.stderr}`);
    }
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function parseForm(body) {
  // A Stripe manda formulário com chaves aninhadas: items[0][price]=preco
  const params = new URLSearchParams(body.toString("utf8"));
  const out = {};
  for (const [key, value] of params.entries()) {
    const caminho = key.replace(/\]/g, "").split("[");
    let alvo = out;
    caminho.forEach((parte, index) => {
      if (index === caminho.length - 1) {
        alvo[parte] = value;
      } else {
        alvo[parte] = alvo[parte] || {};
        alvo = alvo[parte];
      }
    });
  }
  return out;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const inDays = (days) => nowSeconds() + days * 86400;

/** Estado da Stripe falsa: assinaturas, clientes e faturas em memória. */
function createStripeState() {
  return {
    customers: new Map(),
    coupons: new Map(),
    subscriptions: new Map(),
    invoices: [],
    checkoutSessions: [],
    portalSessions: [],
    portalConfigurations: new Map(),
    /** Cria/atualiza uma assinatura como a Stripe devolveria. */
    upsertSubscription(id, data = {}) {
      const atual = this.subscriptions.get(id) || {
        id,
        object: "subscription",
        status: "active",
        customer: data.customer || "cus_teste",
        current_period_end: inDays(30),
        cancel_at: null,
        cancel_at_period_end: false,
        metadata: {},
        items: { object: "list", data: [] },
      };
      const proxima = { ...atual, ...data };
      proxima.items = data.items || atual.items;
      this.subscriptions.set(id, proxima);
      return proxima;
    },
    setItems(id, items) {
      const sub = this.subscriptions.get(id);
      if (!sub) return null;
      sub.items = {
        object: "list",
        data: items.map((item, index) => ({
          id: item.id || `si_${index}_${item.price}`,
          object: "subscription_item",
          quantity: Number(item.quantity ?? 1),
          current_period_end: sub.current_period_end,
          price: { id: item.price, object: "price" },
        })),
      };
      return sub;
    },
  };
}

function handleStripe(req, res, url, body, state) {
  const form = body.length ? parseForm(body) : {};
  const rota = url.pathname;

  // Usada pelo health check para saber se a chave é aceita.
  if (rota === "/v1/account" && req.method === "GET") {
    return json(res, 200, { id: "acct_teste", object: "account", charges_enabled: true });
  }

  if (rota === "/v1/customers" && req.method === "POST") {
    const id = `cus_${crypto.randomBytes(6).toString("hex")}`;
    const customer = { id, object: "customer", email: form.email || null, name: form.name || null, metadata: form.metadata || {} };
    state.customers.set(id, customer);
    return json(res, 200, customer);
  }

  const customerMatch = rota.match(/^\/v1\/customers\/([^/]+)$/);
  if (customerMatch && req.method === "DELETE") {
    state.customers.delete(customerMatch[1]);
    return json(res, 200, { id: customerMatch[1], object: "customer", deleted: true });
  }

  if (rota === "/v1/checkout/sessions" && req.method === "POST") {
    const id = `cs_${crypto.randomBytes(6).toString("hex")}`;
    state.checkoutSessions.push({ id, form });
    return json(res, 200, {
      id,
      object: "checkout.session",
      url: `https://checkout.stripe.test/${id}`,
      client_reference_id: form.client_reference_id || null,
      customer: form.customer || null,
    });
  }

  if (rota === "/v1/billing_portal/configurations" && req.method === "GET") {
    return json(res, 200, { object: "list", data: [...state.portalConfigurations.values()], has_more: false });
  }

  if (rota === "/v1/billing_portal/configurations" && req.method === "POST") {
    const id = `bpc_${crypto.randomBytes(5).toString("hex")}`;
    const configuracao = { id, object: "billing_portal.configuration", features: form.features, metadata: form.metadata || {} };
    state.portalConfigurations.set(id, configuracao);
    return json(res, 200, configuracao);
  }

  if (rota === "/v1/billing_portal/sessions" && req.method === "POST") {
    const id = `bps_${crypto.randomBytes(6).toString("hex")}`;
    state.portalSessions.push({ id, form });
    return json(res, 200, { id, object: "billing_portal.session", url: `https://portal.stripe.test/${id}` });
  }

  const couponMatch = rota.match(/^\/v1\/coupons\/([^/]+)$/);
  if (couponMatch && req.method === "GET") {
    const coupon = state.coupons.get(couponMatch[1]);
    if (!coupon) return json(res, 404, { error: { message: "No such coupon", type: "invalid_request_error" } });
    return json(res, 200, coupon);
  }

  if (rota === "/v1/coupons" && req.method === "POST") {
    const id = `coupon_${crypto.randomBytes(5).toString("hex")}`;
    const coupon = {
      id,
      object: "coupon",
      percent_off: Number(form.percent_off) || null,
      duration: form.duration || "once",
      duration_in_months: Number(form.duration_in_months) || null,
      name: form.name || null,
    };
    state.coupons.set(id, coupon);
    return json(res, 200, coupon);
  }

  if (rota === "/v1/subscriptions" && req.method === "GET") {
    const customer = url.searchParams.get("customer");
    const status = url.searchParams.get("status");
    const data = [...state.subscriptions.values()].filter(
      (sub) => (!customer || sub.customer === customer) && (!status || status === "all" || sub.status === status),
    );
    return json(res, 200, { object: "list", data, has_more: false });
  }

  const subscriptionMatch = rota.match(/^\/v1\/subscriptions\/([^/]+)$/);
  if (subscriptionMatch) {
    const id = subscriptionMatch[1];
    const sub = state.subscriptions.get(id);
    if (!sub) {
      return json(res, 404, { error: { message: `No such subscription: ${id}`, type: "invalid_request_error" } });
    }

    if (req.method === "GET") {
      // A Stripe aceita expand[0]=..., expand[]=... e expand=...
      const expandiu = [...url.searchParams.entries()].some(
        ([chave, valor]) => chave.startsWith("expand") && String(valor).startsWith("discounts"),
      );
      // Sem expand, a Stripe manda só o id do desconto.
      const resposta = expandiu
        ? sub
        : { ...sub, discount: sub.discount?.id || null, discounts: (sub.discounts || []).map((d) => d.id) };
      return json(res, 200, resposta);
    }

    if (req.method === "DELETE") {
      sub.status = "canceled";
      sub.canceled_at = nowSeconds();
      return json(res, 200, sub);
    }

    // POST = update
    if (form.cancel_at_period_end !== undefined) {
      sub.cancel_at_period_end = form.cancel_at_period_end === "true";
      sub.cancel_at = sub.cancel_at_period_end ? sub.current_period_end : null;
    }
    if (form.cancel_at !== undefined) {
      sub.cancel_at = form.cancel_at === "" ? null : Number(form.cancel_at);
      sub.cancel_at_period_end = Boolean(sub.cancel_at);
    }
    if (form.metadata) sub.metadata = { ...sub.metadata, ...form.metadata };
    const aplicarCupom = (couponId) => {
      const coupon = state.coupons.get(couponId) || { id: couponId };
      const meses = Number(coupon.duration_in_months) || 0;
      const discount = {
        id: `di_${couponId}`,
        object: "discount",
        // Como a API da Stripe devolve hoje: só a referência do cupom.
        source: { coupon: couponId, type: "coupon" },
        start: nowSeconds(),
        end: meses ? nowSeconds() + meses * 30 * 86400 : null,
      };
      sub.discounts = [discount];
      sub.discount = discount;
    };
    if (form.discounts) {
      Object.values(form.discounts).forEach((item) => item.coupon && aplicarCupom(item.coupon));
    }
    if (form.coupon) aplicarCupom(form.coupon);

    if (form.items) {
      const pedidos = Object.values(form.items);
      const atuais = [...(sub.items?.data || [])];
      for (const pedido of pedidos) {
        if (pedido.deleted === "true") {
          const posicao = atuais.findIndex((item) => item.id === pedido.id);
          if (posicao >= 0) atuais.splice(posicao, 1);
          continue;
        }
        const existente = atuais.find((item) => item.id === pedido.id || item.price?.id === pedido.price);
        if (existente) {
          existente.quantity = Number(pedido.quantity ?? existente.quantity);
          if (pedido.price) existente.price = { id: pedido.price, object: "price" };
        } else {
          atuais.push({
            id: `si_${crypto.randomBytes(4).toString("hex")}`,
            object: "subscription_item",
            quantity: Number(pedido.quantity ?? 1),
            current_period_end: sub.current_period_end,
            price: { id: pedido.price, object: "price" },
          });
        }
      }
      sub.items = { object: "list", data: atuais };
    }

    // Cobrança imediata gera uma fatura, como na Stripe de verdade.
    if (form.proration_behavior === "always_invoice") {
      state.invoices.unshift(buildInvoice(sub, { billingReason: "subscription_update", amount: 1000 }));
    }

    return json(res, 200, sub);
  }

  if (rota === "/v1/invoices" && req.method === "GET") {
    const customer = url.searchParams.get("customer");
    const status = url.searchParams.get("status");
    const data = state.invoices.filter(
      (invoice) => (!customer || invoice.customer === customer) && (!status || invoice.status === status),
    );
    return json(res, 200, { object: "list", data, has_more: false });
  }

  if (rota === "/v1/invoices/create_preview" && req.method === "POST") {
    const sub = state.subscriptions.get(form.subscription) || null;
    const base = 4700;
    const cupomDaAssinatura =
      sub?.discounts?.[0]?.source?.coupon || sub?.discounts?.[0]?.coupon || null;
    const percentual = Number(state.coupons.get(cupomDaAssinatura)?.percent_off || 0);
    const comDesconto = Math.round(base * (1 - percentual / 100));
    return json(res, 200, {
      object: "invoice",
      amount_due: comDesconto,
      amount_remaining: comDesconto,
      currency: "brl",
      next_payment_attempt: null,
      lines: {
        object: "list",
        data: [
          { description: "Ajuste proporcional", amount: 4700, quantity: 1, proration: true, period: { start: nowSeconds(), end: sub?.current_period_end || inDays(30) } },
        ],
      },
    });
  }

  return json(res, 404, { error: { message: `rota falsa não implementada: ${req.method} ${rota}`, type: "invalid_request_error" } });
}

function buildInvoice(subscription, { billingReason = "subscription_cycle", amount = 12900 } = {}) {
  const id = `in_${crypto.randomBytes(6).toString("hex")}`;
  return {
    id,
    object: "invoice",
    number: `XF-${id.slice(3, 9).toUpperCase()}`,
    status: "paid",
    customer: subscription?.customer || "cus_teste",
    customer_email: "cliente@test.com",
    created: nowSeconds(),
    period_start: nowSeconds(),
    period_end: subscription?.current_period_end || inDays(30),
    amount_due: amount,
    amount_paid: amount,
    currency: "brl",
    hosted_invoice_url: `https://faturas.stripe.test/${id}`,
    invoice_pdf: `https://faturas.stripe.test/${id}.pdf`,
    billing_reason: billingReason,
    status_transitions: { paid_at: nowSeconds() },
    lines: {
      object: "list",
      data: [{ description: "Assinatura Pauta", amount, quantity: 1, proration: false }],
    },
  };
}

/** Sobe os dois servidores falsos e devolve o controle deles. */
async function startFakes({ httpPort, httpsPort, storageZone = "pauta" }) {
  const objects = new Map(); // caminho na storage -> Buffer
  const stripe = createStripeState();
  // Prefeitura de mentira: guarda as notas emitidas nos testes.
  const nfse = new Map();
  const nfsePorDps = new Map();
  const nfseEventos = [];
  const emails = []; // e-mails que o app tentaria enviar (capturados pelo SMTP falso não existe; ver harness)

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const body = await readBody(req);

    if (url.pathname.startsWith("/v1/")) {
      return handleStripe(req, res, url, body, stripe);
    }

    // BrasilAPI: consulta de CNPJ
    const cnpjMatch = url.pathname.match(/^\/api\/cnpj\/v1\/(\d{14})$/);
    if (cnpjMatch) {
      if (cnpjMatch[1].startsWith("00000000")) {
        return json(res, 404, { message: "CNPJ não encontrado" });
      }
      return json(res, 200, {
        cnpj: cnpjMatch[1],
        razao_social: "EMPRESA TESTE LTDA",
        nome_fantasia: "Empresa Teste",
        descricao_situacao_cadastral: "ATIVA",
        municipio: "SAO PAULO",
        uf: "SP",
      });
    }

    // Listagem da raiz da zona: é o que o health check consulta.
    if (req.method === "GET" && new RegExp(`^/${storageZone}/?$`).test(url.pathname)) {
      return json(res, 200, [...objects.keys()].map((caminho) => ({ ObjectName: caminho, IsDirectory: false })));
    }

    // ViaCEP: devolve o código do IBGE, que a DPS exige e a Stripe não guarda.
    const viaCep = url.pathname.match(/^\/(\d{8})\/json\/?$/);
    if (viaCep && req.method === "GET") {
      if (viaCep[1] === "00000000") return json(res, 200, { erro: true });
      return json(res, 200, {
        cep: viaCep[1],
        logradouro: "RUA DE TESTE",
        bairro: "CENTRO",
        localidade: "SAO PAULO",
        uf: "SP",
        ibge: "3550308",
      });
    }

    // Prefeitura (NFS-e): recebe a DPS compactada e devolve a nota.
    if (url.pathname === "/notafiscal-ws/nfse" && req.method === "POST") {
      const enviado = body.length ? JSON.parse(body.toString()) : {};
      if (!enviado.dpsXmlGZipB64) {
        return json(res, 400, { mensagem: "DPS ausente." });
      }
      const xml = require("zlib").gunzipSync(Buffer.from(enviado.dpsXmlGZipB64, "base64")).toString("utf8");
      if (!xml.includes("<Signature") && !xml.includes(":Signature")) {
        return json(res, 400, { mensagem: "DPS sem assinatura digital." });
      }
      const idDps = (xml.match(/Id="([^"]+)"/) || [])[1] || "";
      const chave = `351${idDps.slice(-12)}${String(nfse.size + 1).padStart(8, "0")}`;
      const nota = {
        chaveAcesso: chave,
        idDps,
        nfseNumero: String(nfse.size + 1),
        dataEmissao: new Date().toISOString(),
        xmlEnviado: xml,
      };
      nfse.set(chave, nota);
      nfsePorDps.set(idDps, chave);
      return json(res, 201, nota);
    }

    const consultaNfse = url.pathname.match(/^\/notafiscal-ws\/nfse\/([^/]+)$/);
    if (consultaNfse && req.method === "GET") {
      const nota = nfse.get(decodeURIComponent(consultaNfse[1]));
      if (!nota) return json(res, 404, { mensagem: "NFS-e não encontrada." });
      return json(res, 200, nota);
    }

    const consultaPorDps = url.pathname.match(/^\/notafiscal-ws\/nfse\/dps\/([^/]+)$/);
    if (consultaPorDps && req.method === "GET") {
      const chave = nfsePorDps.get(decodeURIComponent(consultaPorDps[1]));
      if (!chave) return json(res, 404, { mensagem: "DPS não encontrada." });
      return json(res, 200, { chaveAcesso: chave });
    }

    const evento = url.pathname.match(/^\/notafiscal-ws\/nfse\/([^/]+)\/eventos$/);
    if (evento && req.method === "POST") {
      const chave = decodeURIComponent(evento[1]);
      if (!nfse.get(chave)) return json(res, 404, { mensagem: "NFS-e não encontrada." });
      nfseEventos.push({ chave, em: new Date().toISOString() });
      return json(res, 200, { chaveAcesso: chave, evento: "registrado" });
    }

    // API de storage da Bunny
    const storageMatch = url.pathname.match(new RegExp(`^/${storageZone}/(.+)$`));
    if (storageMatch) {
      const storagePath = decodeURIComponent(storageMatch[1]).split("/").map(decodeURIComponent).join("/");
      if (req.method === "PUT") {
        objects.set(storagePath, body);
        return json(res, 201, { HttpCode: 201, Message: "File uploaded." });
      }
      if (req.method === "GET") {
        const file = objects.get(storagePath);
        if (!file) return json(res, 404, { HttpCode: 404, Message: "Not found" });
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": file.length });
        return res.end(file);
      }
      if (req.method === "DELETE") {
        const existia = objects.delete(storagePath);
        return json(res, existia ? 200 : 404, { HttpCode: existia ? 200 : 404 });
      }
    }

    return json(res, 404, { message: "rota falsa desconhecida", path: url.pathname });
  });

  // CDN da Bunny (https), usada quando o servidor baixa um arquivo.
  const httpsServer = https.createServer(ensureCertificate(), (req, res) => {
    const url = new URL(req.url, "https://127.0.0.1");
    const storagePath = url.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/");
    const file = objects.get(storagePath);
    if (!file) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": file.length });
    return res.end(file);
  });

  await new Promise((resolve) => httpServer.listen(httpPort, "127.0.0.1", resolve));
  await new Promise((resolve) => httpsServer.listen(httpsPort, "127.0.0.1", resolve));

  return {
    objects,
    stripe,
    emails,
    nfse,
    nfseEventos,
    buildInvoice,
    stop: async () => {
      await new Promise((resolve) => httpServer.close(resolve));
      await new Promise((resolve) => httpsServer.close(resolve));
    },
  };
}

module.exports = { startFakes, buildInvoice };
