'use strict';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
};

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  isProd: process.env.NODE_ENV === 'production',

  // Nombre de proxies de confiance devant le backend (#144). Détermine req.ip,
  // clé du rate-limiting par IP. Dev (accès direct) : 0/1. Prod derrière
  // Traefik + nginx : 2.
  trustProxy: parseInt(process.env.TRUST_PROXY || '1', 10),

  // État temps-réel PvP (file, sessions, présence) externalisé dans Redis pour
  // le scaling multi-instance (#31). Obligatoire : pas de repli mémoire.
  redis: {
    url: required('REDIS_URL'),
  },

  db: {
    host:     process.env.PGHOST     || 'localhost',
    port:     parseInt(process.env.PGPORT || '5432', 10),
    user:     required('PGUSER'),
    password: required('PGPASSWORD'),
    database: required('PGDATABASE'),
    ssl: process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : false,
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  smtp: {
    host: required('SMTP_HOST'),
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'La Chouine <contact@la-chouine.com>',
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'https://la-chouine.com',
  },

  auth: {
    bcryptRounds: 12,
    verifyTokenTtlMs: parseInt(process.env.VERIFY_TOKEN_TTL_MS || '86400000', 10),
  },
};
