/**
 * Portal-Mock — Einstiegspunkt (Prototyp, C-P.1).
 *
 * Stellt das Kundenportal nach: genau ein Login-Einstieg, Registrierungsfrage
 * und -formular, geschützter Bereich, Fehlermeldungen. Keine Fachdaten.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.js';
import { openDb } from './db.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { recoveryRoutes } from './routes/recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = openDb(cfg.dbPath);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// Einfache Sicherheits-Header (Prototyp-Level)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'");
  // API-Antworten (u. a. /api/session, /api/logout) nie cachen — sonst könnten
  // autorisierte Zustände aus dem HTTP-Cache/Browser-Cache wieder auftauchen.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// Statische Dateien. Das SPA-Dokument (index.html) wird NIE gecacht: verhindert,
// dass geschützte Ansichten über den Back/Forward-Cache der Browser-History
// sichtbar werden (Issue 1/3). `cacheControl:false` verhindert, dass serve-static
// unseren no-store-Header mit "public, max-age=0" überschreibt.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    cacheControl: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  })
);

publicRoutes(app, db);
recoveryRoutes(app, db);
adminRoutes(app, db);

// Fehler-Rückgabewert: verständlich, ohne Stacktrace, ohne Existenzauskunft (SEC-04)
app.use((err, req, res, next) => {
  console.warn('[portal] unerwarteter Fehler:', err?.message);
  if (res.headersSent) return next(err);
  return res.status(500).json({ message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
});

app.listen(cfg.port, () => {
  console.log(`[portal-mock] läuft auf ${cfg.publicBaseUrl}`);
  console.log(`[portal-mock] Phase-Datei: ${cfg.phaseConfigFile}`);
  console.log(`[portal-mock] DB: ${cfg.dbPath}`);
  console.log(`[portal-mock] Keycloak: ${cfg.keycloakUrl}/realms/${cfg.realm}`);
});