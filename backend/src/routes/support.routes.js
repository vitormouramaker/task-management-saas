const express = require("express");
const { postgres } = require("../server/connect");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePlatformAdmin } = require("../middlewares/platform-admin.middleware");
const {
  SupportError,
  addMessage,
  assertCustomerConversation,
  getSupportPolicy,
  listCustomerConversations,
  listMessages,
  listTeamConversations,
  loadTeamConversation,
  markRead,
  serializeConversation,
  listSurveys,
  saveSurvey,
  setStatus,
  startConversation,
} = require("../services/support.service");

function handle(fn, fallback) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      if (error instanceof SupportError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      console.error(`[suporte] ${fallback}`, error);
      return res.status(500).json({ message: fallback });
    }
  };
}

// ---------------------------------------------------------------- cliente
const customer = express.Router();
customer.use(verifyToken);

customer.get(
  "/",
  handle(async (req, res) => {
    const [policy, conversations] = await Promise.all([
      getSupportPolicy(req.user.organizationId),
      listCustomerConversations({ memberId: req.user.id, organizationId: req.user.organizationId }),
    ]);
    return res.json({ policy, conversations });
  }, "Não foi possível carregar o suporte."),
);

customer.post(
  "/",
  handle(async (req, res) => {
    const result = await startConversation(req.user, req.body || {});
    return res.status(201).json(result);
  }, "Não foi possível abrir a conversa."),
);

customer.get(
  "/:id",
  handle(async (req, res) => {
    const conversation = await assertCustomerConversation(req.user, req.params.id);
    await markRead(conversation, "customer");
    return res.json({
      conversation: serializeConversation({ ...conversation, customer_unread: 0 }),
      messages: await listMessages(postgres, conversation.id),
    });
  }, "Não foi possível abrir a conversa."),
);

customer.post(
  "/:id/messages",
  handle(async (req, res) => {
    const conversation = await assertCustomerConversation(req.user, req.params.id);
    const result = await addMessage({
      conversation,
      authorId: req.user.id,
      authorType: "customer",
      body: req.body?.body,
    });
    return res.status(201).json(result);
  }, "Não foi possível enviar a mensagem."),
);

// Encerrar a conversa é da equipe; o cliente responde a pesquisa depois.
customer.post(
  "/:id/survey",
  handle(async (req, res) => {
    const conversation = await assertCustomerConversation(req.user, req.params.id);
    const { rating } = await saveSurvey(conversation, req.user.id, req.body || {});
    return res.status(201).json({ rating, message: "Obrigado pela avaliação!" });
  }, "Não foi possível registrar a avaliação."),
);

// ---------------------------------------------------------------- equipe
const team = express.Router();
team.use(verifyToken, requirePlatformAdmin);

team.get(
  "/",
  handle(async (req, res) => {
    return res.json(
      await listTeamConversations({
        status: req.query.status,
        search: String(req.query.search || "").trim(),
        page: req.query.page,
      }),
    );
  }, "Não foi possível carregar as conversas."),
);

team.get(
  "/avaliacoes",
  handle(async (_req, res) => res.json(await listSurveys()), "Não foi possível carregar as avaliações."),
);

team.get(
  "/:id",
  handle(async (req, res) => {
    const conversation = await loadTeamConversation(req.params.id);
    await markRead(conversation, "team");
    const policy = conversation.organization_id
      ? await getSupportPolicy(conversation.organization_id)
      : null;
    return res.json({
      conversation: serializeConversation({ ...conversation, team_unread: 0 }),
      policy,
      messages: await listMessages(postgres, conversation.id),
    });
  }, "Não foi possível abrir a conversa."),
);

team.post(
  "/:id/messages",
  handle(async (req, res) => {
    const conversation = await loadTeamConversation(req.params.id);
    const result = await addMessage({
      conversation,
      authorId: req.user.id,
      authorType: "team",
      body: req.body?.body,
    });
    return res.status(201).json(result);
  }, "Não foi possível enviar a resposta."),
);

team.patch(
  "/:id",
  handle(async (req, res) => {
    const conversation = await loadTeamConversation(req.params.id);
    return res.json({ conversation: await setStatus(conversation, req.body?.status) });
  }, "Não foi possível atualizar a conversa."),
);

module.exports = { customerSupportRoutes: customer, teamSupportRoutes: team };
