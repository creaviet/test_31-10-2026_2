/**
 * Betriebs-Routen (R-OPS) — API-05..API-08 laut technical-spec §6.
 *
 * - Authentifizierung: statisches R-OPS-Token (Prototyp; vor Produktivgang
 *   durch echte Betriebs-Identität ersetzen).
 * - Jede Phasenänderung wird mit changed_by/reason protokolliert (PR-07).
 * - Erreichbarkeitstest: Prototyp-Variante über die Keycloak-Admin-API
 *   (Credential-Liste je Nutzer) — Verfahrensdetail OQ-TS-3 bleibt offen.
 */
import { Router } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { cfg } from '../config.js';
import { readPhase, writePhase } from '../phase.js';
import { logEvent, refOf, listEvents } from '../db.js';
import * as kc from '../keycloak.js';
import { issueRecoveryCode } from '../recovery/store.js';

export const adminRoutes = (app, db) => {
  const r = Router();

  function isOps(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return 'missing';
    const a = Buffer.from(token);
    const b = Buffer.from(cfg.ropsToken);
    return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong';
  }

  r.use('/api/admin', (req, res, next) => {
    const state = isOps(req);
    if (state === 'missing') return res.status(401).json({ message: 'Nicht angemeldet.' });
    if (state === 'wrong') return res.status(403).json({ message: 'Zugriff verweigert.' });
    next();
  });

  // API-05  GET /api/admin/phase
  r.get('/api/admin/phase', (req, res) => {
    const phase = readPhase();
    if (phase.error) return res.status(500).json({ message: 'Phasenschalter nicht verfügbar.' });
    return res.json(phase);
  });

  // API-06  PUT /api/admin/phase
  r.put('/api/admin/phase', (req, res) => {
    const { phase, reason } = req.body ?? {};
    const reasonStr = typeof reason === 'string' ? reason.trim() : '';
    if (!['phase1', 'phase2'].includes(phase)) {
      return res.status(400).json({ message: 'phase muss phase1 oder phase2 sein.' });
    }
    if (reasonStr.length < 5) {
      return res.status(400).json({ message: 'reason ist Pflicht (mindestens 5 Zeichen).' });
    }
    const current = readPhase();
    if (current.error) return res.status(500).json({ message: 'Phasenschalter nicht verfügbar.' });
    if (current.phase === phase) {
      return res.status(409).json({ message: 'Die Phase ist bereits aktiv.' });
    }
    const saved = writePhase({ phase, reason: reasonStr, changedBy: 'R-OPS' });
    logEvent(db, {
      eventType: 'phase_change',
      result: 'success',
      detail: JSON.stringify({ changed_by: 'R-OPS', reason: reasonStr, phase }),
    });
    return res.json({ phase: saved.phase, changed_at: saved.changed_at, changed_by: saved.changed_by });
  });

  // API-07  POST /api/admin/reachability-test
  let running = null;

  r.post('/api/admin/reachability-test', async (req, res) => {
    if (running) return res.status(409).json({ message: 'Ein Test läuft bereits.' });
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    running = runId;

    res.status(202).json({ run_id: runId });

    // Job läuft asynchron weiter (nie im Login-Pfad, ARCH-07)
    void (async () => {
      const failures = [];
      let checked = 0;
      try {
        let first = 0;
        for (;;) {
          const users = await kc.listUsers(first, 200);
          if (users.length === 0) break;
          for (const u of users) {
            if (!u.username || !/^[0-9a-f]{32}$/.test(u.username)) continue;
            checked += 1;
            const creds = await kc.listCredentials(u.id);
            if (!creds || !kc.hasWebAuthnCredential(creds)) {
              failures.push({ reference: refOf(u.username), credential_id: null });
            }
          }
          first += users.length;
          if (users.length < 200) break;
        }
      } catch (err) {
        console.warn('[reachability] Fehler:', err.message);
      } finally {
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO reachability_result (run_id, started_at, finished_at, checked_count, failed_json)
           VALUES (?, ?, ?, ?, ?)`
        );
        stmt.run(runId, startedAt, new Date().toISOString(), checked, JSON.stringify(failures));
        running = null;
      }
    })();
  });

  // API-08  GET /api/admin/reachability-results
  r.get('/api/admin/reachability-results', (req, res) => {
    const row = db.prepare(`SELECT * FROM reachability_result ORDER BY started_at DESC LIMIT 1`).get();
    if (!row) return res.status(404).json({ message: 'Noch kein Testlauf vorhanden.' });
    const failures = JSON.parse(row.failed_json || '[]');
    return res.json({
      summary: {
        run_id: row.run_id,
        started_at: row.started_at,
        finished_at: row.finished_at,
        checked_count: row.checked_count,
        failed_count: failures.length,
      },
      failures,
    });
  });

  // API-09: Recovery-Code ausstellen (bei erstmaliger Passkey-Registrierung, BR-16)
  r.post('/api/admin/recovery/issue', async (req, res) => {
    try {
      const body = req.body ?? {};
      const verifiId = String(body.verifiId || body.verifi_id || '').trim();
      const realm = String(body.realm || cfg.realm || 'passkey-prototyp');
      const penr = String(body.penr || verifiId).trim(); // PENR - im Prototyp ableitbar

      if (!verifiId) {
        return res.status(400).json({ message: 'verifiId erforderlich.' });
      }

      // Sicherstellen, dass User existiert
      const user = await kc.findUserByVerifiId(verifiId).catch(() => null);
      if (!user) {
        return res.status(404).json({ message: 'Nutzer nicht gefunden.' });
      }

      const issued = issueRecoveryCode({ realm, penr, verifiId });
      if (!issued) {
        return res.status(400).json({ message: 'Realm nicht für Recovery freigegeben.' });
      }

      logEvent(db, {
        eventType: 'ops_action',
        result: 'success',
        reference: refOf(verifiId),
        detail: `recovery_code_issued:${realm}`,
      });

      // Nur im Prototyp: Code zurückgeben (in Produktion sicher übergeben)
      return res.json({ ok: true, realm: issued.realm, penr: issued.penr, code: issued.code });
    } catch (err) {
      console.warn('[admin/recovery/issue] Fehler:', err.message);
      return res.status(500).json({ message: 'Ein technischer Fehler ist aufgetreten.' });
    }
  });

  // Prototyp-Erweiterung (nicht in technical-spec §6): Ereignisprotokoll für
  // Abnahme-Nachweise (AC-3 "Ursache aus Protokoll lesbar", AC-14 Stichprobe).
  r.get('/api/admin/events', (req, res) => {
    return res.json({ events: listEvents(db, { limit: 200 }) });
  });

  app.use(r);
};