'use strict';

const express = require('express');
const { query } = require('../db');
const { verifyToken } = require('../middleware/auth');
const { isUuid } = require('../services/uuid');
const visits = require('../services/visits');

const router = express.Router();

// ─── POST /api/visits ─────────────────────────────────────────────────────────

// Page vue (#311), envoyée par le client à chaque changement de page. Répond
// toujours 204 : le client n'a rien à en faire, et un échec ne doit pas le gêner.
router.post('/', async (req, res) => {
  const userAgent = String(req.get('user-agent') || '').slice(0, 400);
  const path = visits.cleanPath(req.body?.path);
  if (!path || visits.isBot(userAgent)) return res.status(204).end();

  // Session facultative : seule la signature est vérifiée, pour relier la visite
  // au compte dans les statistiques.
  const header = req.get('authorization') || '';
  const user = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;

  try {
    await visits.recordVisit(query, {
      ip: req.ip,
      userAgent,
      path,
      referrer: req.body?.referrer,
      source: req.body?.source,
      userId: user && isUuid(user.id) ? user.id : null,
    });
  } catch (err) {
    req.log.error({ code: err.code }, 'POST /visits');
  }
  res.status(204).end();
});

module.exports = router;
