/**
 * Passkey-Recovery Routes (FR-100 ff.)
 */
import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { cfg } from '../config.js';
import { createSession, getSession } from '../store.js';
import { logEvent, refOf } from '../db.js';
import { isLimited } from '../rate-limit.js';
import * as kc from '../keycloak.js';
import { validateAndConsume, isSupportedRealm } from '../recovery/store.js';

export const recoveryRoutes = (app, db) => {
  const r = Router();
  const cookieName = 'portal_sid';

  function parseCookies(req) {
    const out = {};
    const h = req.headers.cookie;
    if (!h) return out;
    for (const part of h.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function setSessionCookie(res, sid) {
    res.setHeader(
      'set-cookie',
      `${cookieName}=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(cfg.sessionTtlMs / 1000)}`
    );
  }

  const json = (res, status, body) => res.status(status).json(body);

  // POST /api/recovery/start - PENR + Einmalcode erfassen und validieren
  r.post('/api/recovery/start', async (req, res) => {
    try {
      const body = req.body ?? {};
      const penr = String(body.penr || '').trim();
      const code = String(body.code || '').trim();
      const realm = String(body.realm || cfg.realm || 'passkey-prototyp');

      if (!penr || !code) {
        // Keine Auskunft über Existenz
        return json(res, 400, { message: 'Die Angaben konnten nicht verarbeitet werden. Bitte versuchen Sie es erneut.' });
      }

      if (!isSupportedRealm(realm)) {
        // Realm-Scoping hart durchsetzen (FR-101)
        return json(res, 400, { message: 'Die Angaben konnten nicht verarbeitet werden. Bitte versuchen Sie es erneut.' });
      }

      if (isLimited({ ip: req.ip, verifiId: penr })) {
        return json(res, 429, { message: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' });
      }

      const result = validateAndConsume({ realm, penr, code });
      if (!result.ok) {
        logEvent(db, {
          eventType: 'login_failed',
          result: 'failure',
          reference: null,
          detail: 'recovery_invalid',
        });
        return json(res, 400, { message: 'Die Angaben konnten nicht verarbeitet werden. Bitte versuchen Sie es erneut.' });
      }

      // Nach erfolgreicher Prüfung: Session anlegen für Recovery-Flow
      const session = createSession(result.verifiId, null);
      setSessionCookie(res, session.sid);
      session.recovery = {
        realm: result.realm,
        penr,
        verifiId: result.verifiId,
        at: new Date().toISOString(),
      };

      logEvent(db, {
        eventType: 'login_success',
        result: 'success',
        reference: refOf(result.verifiId),
        detail: 'recovery_validated',
      });

      return json(res, 200, { ok: true, redirect_url: `${cfg.publicBaseUrl}/recovery/register.html` });
    } catch (err) {
      console.warn('[recovery/start] Fehler:', err.message);
      return json(res, 500, { message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
    }
  });

  // GET /api/recovery/session - Recovery-Session prüfen
  r.get('/api/recovery/session', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session || !session.recovery) {
      return json(res, 401, { message: 'Bitte starten Sie den Wiederherstellungsprozess erneut.' });
    }
    return json(res, 200, {
      verifiId: session.recovery.verifiId,
      realm: session.recovery.realm,
    });
  });

  // POST /api/recovery/register - Neuen Passkey wie bei Ersteinrichtung registrieren
  r.post('/api/recovery/register', async (req, res) => {
    try {
      const session = getSession(parseCookies(req)[cookieName]);
      if (!session || !session.recovery) {
        return json(res, 401, { message: 'Bitte starten Sie den Wiederherstellungsprozess erneut.' });
      }
      if (isLimited({ ip: req.ip, verifiId: session.recovery.verifiId })) {
        return json(res, 429, { message: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' });
      }

      const verifiId = session.recovery.verifiId;
      let user = await kc.findUserByVerifiId(verifiId);
      if (!user) {
        // Falls User nicht existiert, versuchen wir zumindest den Flow zu starten
        return json(res, 400, { message: 'Die Angaben konnten nicht verarbeitet werden. Bitte versuchen Sie es erneut.' });
      }

      // Recovery heißt: den alten Passkey ERSETZEN. Keycloak lehnt eine
      // Neu-Registrierung mit demselben Credential-Namen ab
      // ("Device already exists with the same name" /
      // ModelDuplicateException). Deshalb werden die alten WebAuthn-Credentials
      // VOR der Neu-Registrierung widerrufen — der Nutzer hat den alten Passkey
      // ohnehin verloren, und nur so ist eine echte Ersetzung garantiert.
      //
      // Der frühere "already"-Sonderpfad war zusätzlich falsch: er hat die
      // Pflicht-Aktion übersprungen, keine SSO-Session erzeugt und den Nutzer
      // auf die Keycloak-Loginmaske geschickt (Username = Verifi-Kennung, kein
      // Passwort gesetzt) → "Invalid username or password".
      const creds = await kc.listCredentials(user.id);
      if (!Array.isArray(creds)) {
        // Ohne Credential-Liste kann nicht garantiert ersetzt werden — laut
        // protokollieren, statt später an einem Duplicate-Name-Fehler zu hängen.
        console.warn('[recovery/register] Credential-Liste nicht abrufbar — alte Passkeys können ggf. nicht ersetzt werden.');
      }
      const oldCredentials = (Array.isArray(creds) ? creds : []).filter((c) =>
        String(c.type || '').startsWith('webauthn')
      );
      for (const cred of oldCredentials) {
        await kc.deleteCredential(user.id, cred.id);
      }
      if (oldCredentials.length > 0) {
        logEvent(db, {
          eventType: 'registration',
          result: 'success',
          reference: refOf(verifiId),
          detail: `passkey_recovery_old_credentials_revoked:${oldCredentials.length}`,
        });
      }

      await kc.setRequiredAction(user.id, 'webauthn-register-passwordless');
      const imp = await kc.impersonate(user.id);
      if (imp?.setCookies?.length) {
        res.setHeader('set-cookie', imp.setCookies);
      }
      const registrationId = randomUUID();
      session.kcAuth = {
        context: 'register',
        kcUserId: user.id,
        registrationId,
        verifier: null,
      };
      session.passkeyRecovery = true;

      logEvent(db, {
        eventType: 'registration',
        result: 'success',
        reference: refOf(verifiId),
        detail: 'passkey_recovery',
      });

      return json(res, 201, {
        registration_id: registrationId,
        ceremony: {
          mode: 'keycloak-required-action',
          redirect_to: `${cfg.publicBaseUrl}/api/auth/kc/start?context=register`,
        },
      });
    } catch (err) {
      console.warn('[recovery/register] Fehler:', err.message);
      return json(res, 500, { message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
    }
  });

  // GET /api/recovery/pending-code - Einmalcode zur Anzeige nach der
  // Passkey-Registrierung (BR-16). Der Code liegt ausschließlich in der
  // Server-Session; er wird NICHT geloggt und nach Bestätigung gelöscht.
  r.get('/api/recovery/pending-code', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session) {
      return json(res, 401, { message: 'Bitte melden Sie sich an.' });
    }
    const pending = session.recoveryCode;
    if (!pending) {
      return json(res, 404, { message: 'Kein Einmalcode zur Anzeige vorhanden.' });
    }
    return json(res, 200, {
      code: pending.code,
      penr: pending.penr,
      realm: pending.realm,
    });
  });

  // POST /api/recovery/pending-code/ack - Nutzer bestätigt, den Code gespeichert
  // zu haben. Erst danach wird er aus der Session entfernt.
  r.post('/api/recovery/pending-code/ack', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session) {
      return json(res, 401, { message: 'Bitte melden Sie sich an.' });
    }
    delete session.recoveryCode;
    return json(res, 200, { ok: true });
  });

  app.use(r);
};
