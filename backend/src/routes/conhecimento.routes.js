/**
 * Hub de Conhecimento.
 * - /api/conhecimento/v1/*: API do contrato, autenticada pelo token do link (não é JWT).
 * - /api/integrations/conhecimento: tela de Configurações (titular ou admin gera, vê e revoga o link).
 */
const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requireOrganizationAdmin } = require("../middlewares/organization-admin.middleware");
const conhecimento = require("../services/conhecimento-connector.service");

function responder(res, error, fallback) {
  if (error instanceof conhecimento.ConhecimentoError) return res.status(error.status).json({ message: error.message });
  console.error(`[conhecimento] ${fallback}`, error);
  return res.status(500).json({ message: fallback });
}

// ---------- API do contrato ----------
const contrato = express.Router();
contrato.use(conhecimento.autenticarIntegracao);

contrato.get("/manifest", (req, res) => res.json(conhecimento.manifest(req.conhecimento)));

contrato.get("/items", async (req, res) => {
  try {
    return res.json(
      await conhecimento.listarItens(req.conhecimento, {
        type: req.query.type,
        updatedSince: req.query.updated_since,
        cursor: req.query.cursor,
      }),
    );
  } catch (error) {
    return responder(res, error, "Não foi possível listar os itens.");
  }
});

contrato.get("/items/:id", async (req, res) => {
  try {
    const item = await conhecimento.buscarItem(req.conhecimento, req.params.id);
    return item ? res.json(item) : res.status(404).json({ message: "Item não encontrado." });
  } catch (error) {
    return responder(res, error, "Não foi possível ler o item.");
  }
});

contrato.get("/deleted", async (req, res) => {
  try {
    return res.json(
      await conhecimento.listarExclusoes(req.conhecimento.organizationId, { since: req.query.since, cursor: req.query.cursor }),
    );
  } catch (error) {
    return responder(res, error, "Não foi possível listar as exclusões.");
  }
});

contrato.get("/ids", async (req, res) => {
  try {
    return res.json(
      await conhecimento.listarIds(req.conhecimento, { type: req.query.type, cursor: req.query.cursor }),
    );
  } catch (error) {
    return responder(res, error, "Não foi possível listar os itens.");
  }
});

contrato.post("/webhook", async (req, res) => {
  try {
    await conhecimento.registrarWebhook(req.conhecimento, req.body);
    return res.status(204).end();
  } catch (error) {
    return responder(res, error, "Não foi possível registrar o webhook.");
  }
});

// ---------- Configurações ----------
const configuracao = express.Router();
configuracao.use(verifyToken, requireOrganizationAdmin);

configuracao.get("/", async (req, res) => {
  try {
    return res.json(await conhecimento.statusDaIntegracao(req.user.organizationId));
  } catch (error) {
    return responder(res, error, "Não foi possível carregar a integração.");
  }
});

configuracao.post("/link", async (req, res) => {
  try {
    const resultado = await conhecimento.gerarLink({
      organizationId: req.user.organizationId,
      memberId: req.user.id,
      req,
      incluirPrivados: req.body?.incluirPrivados === true,
    });
    res.set("Cache-Control", "no-store");
    return res.status(201).json(resultado);
  } catch (error) {
    return responder(res, error, "Não foi possível gerar o link.");
  }
});

configuracao.delete("/", async (req, res) => {
  try {
    await conhecimento.revogar(req.user.organizationId);
    return res.status(204).end();
  } catch (error) {
    return responder(res, error, "Não foi possível desconectar.");
  }
});

module.exports = { contrato, configuracao };
