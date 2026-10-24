/**
 * Öffentliche Routen des Portal-Mock — API-01..API-04 plus die internen
 * Ablaufwehre (Verimi-Rückkehr, Entscheidung, Keycloak-Auth, Logout),
 * die im Prototyp für den Browser-Flow nötig sind (dokumentiert in README).
 *
 * Wichtige Regeln (technical-spec §6/§7/§9):
 * - API-02: Kennung prüfen → generische Fehler, KEINE Existenzauskunft (BE-11),
 *   Kennung nie im Log (Referenz = SHA-256-Präfix), Antwortzeit angleichen.
 * - API-03: Registrierung NUR in eigener, gültiger Session (BE-03, AC-P8).
 * - API-04: serverseitige Token-Prüfung (BE-08); Sperrung 'mangels Passkey' (BE-07).
 */
import { Router } from 'express';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { cfg } from '../config.js';
import { readPhase } from '../phase.js';
import { createSession, getSession, deleteSession } from '../store.js';
import { logEvent, refOf, upsertIdentity, getIdentity } from '../db.js';
import { isLimited } from '../rate-limit.js';
import * as kc from '../keycloak.js';

export const publicRoutes = (app, db) => {
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
  const isBrowser = (req) => (req.accepts('html') === 'html') && req.query.format !== 'json';

  // Anzeigename für den geschützten Bereich — kommt aus der Portal-DB
  // (portal_identity, ADR-001), NICHT aus dem login-abhängigen Verimi-Prefill.
  // Fällt auf 'Angemeldet' zurück, wenn (noch) kein Datensatz vorliegt.
  const displayNameOf = (verifiId) => {
    const id = getIdentity(db, verifiId);
    const name = [id?.first_name, id?.last_name].filter(Boolean).join(' ').trim();
    return name || 'Angemeldet';
  };

  // Timing-Angleich für negative Fälle (BE-11, AC-13) — Antwortzeit konstant halten.
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  async function constantTimeFail(res) {
    await sleep(150 + Math.round(Math.random() * 100));
    return res;
  }

  // Erreichbarkeits-Vorprüfung eines Upstream-Dienstes (hier: Verimi-Mock).
  // Zweck: Der Browser darf NICHT auf eine nicht erreichbare Verimi-Seite
  // weitergeleitet werden — sonst zeigt der Browser seine eigene Fehlerseite
  // („Diese Seite ist leider nicht erreichbar", Edge/Chrome). Stattdessen soll
  // die Anwendung eine verständliche Meldung anzeigen (FR-35).
  //   - fetch löst bei JEDER HTTP-Antwort auf (auch 3xx/4xx) → Dienst läuft.
  //   - fetch wirft bei Verbindungsfehler/Timeout/DNS-Fehler → Dienst down.
  //   - redirect:'manual' verhindert Seiteneffekte (kein Folgen einer evtl.
  //     Rückleitung in den Portal-Callback).
  // Die URL stammt AUSSCHLIESSLICH aus der Konfiguration, nie aus Nutzereingaben
  // (kein SSRF-Vektor).
  async function isReachable(url, timeoutMs = 2000) {
    try {
      await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return true;
    } catch {
      return false;
    }
  }

  // Erreichbarkeits-Vorprüfung des Keycloak-Dienstes — Server-zu-Server über
  // cfg.keycloakUrl (Docker: http://keycloak:8082). Geprüft wird der Discovery-
  // Endpoint des Realms. Verhindert, dass der Browser auf der Keycloak-Fehlerseite
  // landet (statt der verständlichen Meldung des Portals).
  const kcProbeUrl = `${cfg.keycloakUrl}/realms/${cfg.realm}/.well-known/openid-configuration`;

  // -------------------------------------------------------------------------
  // API-01  GET /api/auth/start — Phasenschalter lesen und Redirect-Ziel liefern
  // -------------------------------------------------------------------------
  r.get('/api/auth/start', async (req, res) => {
    try {
      const phase = readPhase();
      if (phase.error) {
        if (isBrowser(req)) return res.redirect('/?v=error&m=service');
        return json(res, 503, { message: 'Der Dienst ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.' });
      }
      // Phase 1: Vor der Weiterleitung prüfen, ob der vorgeschaltete
      // Verimi-Dienst überhaupt läuft. Ist er down, würde der Browser auf einer
      // nicht erreichbaren Seite landen (Browser-Fehlerseite). Stattdessen liefern
      // wir eine verständliche Meldung (FR-35, „Anmeldung derzeit nicht möglich").
      if (phase.phase === 'phase1') {
        const up = await isReachable(cfg.verimiInternalUrl);
        if (!up) {
          if (isBrowser(req)) return res.redirect('/?v=error&m=auth');
          return json(res, 503, {
            message:
              'Die Anmeldung ist derzeit nicht möglich, da der Anmeldedienst momentan nicht erreichbar ist. Bitte versuchen Sie es zu einem späteren Zeitpunkt erneut.',
            reason: 'auth',
          });
        }
        return json(res, 200, { phase: phase.phase, redirect_url: cfg.verimiLoginUrl });
      }

      // Phase 2: Kein Verimi, aber Keycloak als vorgeschalteter Anmeldedienst →
      // Erreichbarkeit vor der Weiterleitung prüfen (sonst Keycloak-Fehlerseite).
      if (!(await isReachable(kcProbeUrl))) {
        if (isBrowser(req)) return res.redirect('/?v=error&m=auth');
        return json(res, 503, {
          message:
            'Die Anmeldung ist derzeit nicht möglich, da der Anmeldedienst momentan nicht erreichbar ist. Bitte versuchen Sie es zu einem späteren Zeitpunkt erneut.',
          reason: 'auth',
        });
      }

      return json(res, 200, {
        phase: phase.phase,
        redirect_url: `${cfg.publicBaseUrl}/api/auth/kc/start?context=login`,
      });
    } catch {
      if (isBrowser(req)) return res.redirect('/?v=error&m=service');
      return json(res, 500, { message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
    }
  });

  // -------------------------------------------------------------------------
  // API-02  GET /api/auth/verimi/callback — Rückkehr von Verimi
  // -------------------------------------------------------------------------
  const VERIFI_ID_RE = /^[0-9a-f]{32}$/;

  function verifyMockSignature(q) {
    if (!cfg.verimiHmacSecret) return true; // echte Verimi-Integration: eigene Absicherung (T-01)
    if (!q.ts || !q.sig) return false;
    const ts = Number(q.ts);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const data = [q.ts, q.verifi_id, q.first_name, q.last_name, q.email].join('.');
    const expected = createHmac('sha256', cfg.verimiHmacSecret).update(data).digest();
    const actual = Buffer.from(String(q.sig), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  r.get('/api/auth/verimi/callback', async (req, res) => {
    try {
      const q = req.query;
      const hasParams = Object.prototype.hasOwnProperty.call(q, 'verifi_id');
      const verifiId = String(q.verifi_id || '');
      let session = getSession(parseCookies(req)[cookieName]);

      // JSON-Aufruf OHNE Kennung: Session-basierte Zustandsabfrage (Prototyp-interne
      // Vereinfachung, wird vom SPA für die Vorbefüllung genutzt).
      if (!hasParams) {
        if (!session || !session.verifiId) return json(res, 401, { message: 'Bitte melden Sie sich an.' });
        const user = await kc.findUserByVerifiId(session.verifiId);
        const creds = user ? await kc.listCredentials(user.id) : [];
        const exists = user ? kc.hasWebAuthnCredential(creds) : false;
        return json(res, 200, exists
          ? { passkey_exists: true }
          : { passkey_exists: false, prefill: session.prefill });
      }

      // --- Pflicht-/Formatprüfung (generische Fehler, kein Hinweis auf Existenz) ---
      const invalid =
        !VERIFI_ID_RE.test(verifiId) ||
        !['first_name', 'last_name', 'email'].every((k) => typeof q[k] === 'string' && q[k].length > 0) ||
        !verifyMockSignature(q);

      if (invalid) {
        logEvent(db, {
          eventType: 'login_failed',
          result: 'failure',
          reference: VERIFI_ID_RE.test(verifiId) ? refOf(verifiId) : null,
          detail: 'ungültige Kennung bzw. ungültige Rückkehr-Parameter',
        });
        await constantTimeFail(res);
        if (isBrowser(req)) return res.redirect('/?v=error&m=invalid');
        return json(res, 400, { message: 'Die Anmeldung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.' });
      }

      if (isLimited({ ip: req.ip, verifiId })) return json(res, 429, { message: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' });

      // --- Identität etablieren: neue Session bzw. Wechsel sauber trennen ---
      if (!session || session.verifiId !== verifiId) {
        session = createSession(verifiId, {
          first_name: String(q.first_name),
          last_name: String(q.last_name),
          email: String(q.email),
        });
        setSessionCookie(res, session.sid);
      }

      // Logout-Herkunft markieren (ADR-002): Diese Session entstand über den
      // Verimi-Weg. Nur dann muss der Logout die Verimi-SSO beenden — reine
      // Passkey-/Phase-2-Sessions (KC-Callback) bleiben davon unberührt.
      session.viaVerimi = true;

      // Identität in der Portal-DB ablegen (ADR-001): Der Anzeigename kommt
      // künftig aus portal_identity, unabhängig vom Login-Weg. Das Prefill in
      // der Session dient weiterhin nur der Formular-Vorbefüllung.
      upsertIdentity(db, {
        verifiId,
        firstName: String(q.first_name),
        lastName: String(q.last_name),
        email: String(q.email),
      });

      // --- Sperrlogik: antwortet die Phase nicht mehr zum Verimi-Weg? (BE-07) ---
      const phase = readPhase();
      if (phase.error) return isBrowser(req) ? res.redirect('/?v=error&m=service') : json(res, 503, { message: 'Der Dienst ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.' });
      if (phase.phase !== 'phase1') {
        if (!session.blockedLogged) {
          logEvent(db, { eventType: 'blocked', result: 'failure', reference: refOf(verifiId), detail: 'mangels Passkey' });
          session.blockedLogged = true;
        }
        return isBrowser(req) ? res.redirect('/?v=blocked') : json(res, 403, { message: 'Die Anmeldung ist derzeit nicht möglich.' });
      }

      // --- Passkey-Vorhandensein prüfen (BE-02, DB-02) — BEST-EFFORT ---
      // Diese Prüfung entscheidet NUR, ob zusätzlich die Registrierung angeboten
      // wird — sie ist KEINE Voraussetzung für den Zugang. In Phase 1 genügt die
      // erfolgreiche Verimi-Authentifizierung für den geschützten Bereich.
      // Ist Keycloak nicht erreichbar, darf die an sich erfolgreiche Verimi-
      // Anmeldung deshalb NICHT scheitern (sonst technische Fehlerseite): wir
      // gewähren den Zugang und lassen die Registrierungsfrage entfallen (die
      // Registrierung selbst benötigt Keycloak ohnehin).
      let passkeyExists = false;
      let kcAvailable = true;
      try {
        const user = await kc.findUserByVerifiId(verifiId);
        const creds = user ? await kc.listCredentials(user.id) : [];
        passkeyExists = user ? kc.hasWebAuthnCredential(creds) : false;
      } catch (err) {
        kcAvailable = false;
        console.warn('[api-02] Passkey-Prüfung nicht möglich (Keycloak nicht erreichbar):', err.message);
      }

      // Passkey vorhanden ODER Keycloak nicht erreichbar → direkt in den
      // geschützten Bereich (im zweiten Fall ohne Registrierungsfrage).
      if (passkeyExists || !kcAvailable) {
        // Entscheidung 2026-10-08 (Projektträger): Verimi-Authentifizierung genügt in
        // Phase 1 für den geschützten Bereich — KEINE erneute Passkey-Abfrage mehr
        // (bisheriger Verify-Pfad entfernt; konsistent zum „Nein"-Pfad FR-12/AC-P2).
        // Der Passkey bleibt über den neuen Einstieg „Passkey Login" nutzbar (T2b).
        if (isBrowser(req)) {
          logEvent(db, { eventType: 'login_success', result: 'success', reference: refOf(verifiId) });
          return res.redirect('/?v=protected');
        }
        return json(res, 200, { passkey_exists: passkeyExists });
      }

      // Kein Passkey → Registrierungsfrage (bei jedem Login erneut, NFR-UX-04)
      if (isBrowser(req)) return res.redirect('/?v=question');
      return json(res, 200, { passkey_exists: false, prefill: session.prefill });
    } catch (err) {
      console.warn('[api-02] Fehler:', err.message);
      // Browsern eine verständliche Seite zeigen statt rohem JSON (FR-35).
      if (isBrowser(req)) return res.redirect('/?v=error&m=service');
      return json(res, 500, { message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
    }
  });

  // -------------------------------------------------------------------------
  // Prototyp-intern: Vorbefüllung für das Registrierungsformular (aus der Session)
  // -------------------------------------------------------------------------
  r.get('/api/auth/prefill', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session || !session.prefill) return json(res, 401, { message: 'Bitte melden Sie sich an.' });
    return json(res, 200, { prefill: session.prefill });
  });

  // -------------------------------------------------------------------------
  // Prototyp-intern: Entscheidung „Nein" (FR-12, AC-P2) — ohne Fehlermeldung, ohne Sperrhinweis
  // -------------------------------------------------------------------------
  r.get('/auth/decision/no', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session || !session.verifiId) return res.redirect('/');
    session.decision = 'no';
    res.redirect('/?v=protected');
  });

  // -------------------------------------------------------------------------
  // API-03  POST /api/registration — Passkey-Registrierung (nur eigene Session)
  // -------------------------------------------------------------------------
  const NAME_MAX = 100;
  const EMAIL_MAX = 254;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  r.post('/api/registration', async (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session || !session.verifiId) return json(res, 401, { message: 'Bitte melden Sie sich an.' });
    if (isLimited({ ip: req.ip, verifiId: session.verifiId })) return json(res, 429, { message: 'Zu viele Versuche. Bitte versuchen Sie es später erneut.' });

    const body = req.body ?? {};
    const keys = Object.keys(body).sort();
    const validShape =
      keys.length === 3 &&
      keys.every((k) => ['first_name', 'last_name', 'email'].includes(k)) &&
      typeof body.first_name === 'string' &&
      typeof body.last_name === 'string' &&
      typeof body.email === 'string';

    const first = validShape ? body.first_name.trim() : '';
    const last = validShape ? body.last_name.trim() : '';
    const email = validShape ? body.email.trim() : '';

    const validContent =
      first.length >= 1 && first.length <= NAME_MAX &&
      last.length >= 1 && last.length <= NAME_MAX &&
      email.length >= 3 && email.length <= EMAIL_MAX && EMAIL_RE.test(email);

    // Vorbefüllte Daten müssen mit der verifizierten Verimi-Rückkehr übereinstimmen
    // (kein Identitätswechsel möglich, FR-15/BE-03).
    const matchesPrefill =
      session.prefill &&
      first === session.prefill.first_name &&
      last === session.prefill.last_name &&
      email === session.prefill.email;

    if (!validShape || !validContent || !matchesPrefill) {
      return json(res, 400, { message: 'Die Daten konnten nicht übernommen werden. Bitte versuchen Sie es erneut.' });
    }

    try {
      let user = await kc.findUserByVerifiId(session.verifiId);
      if (!user) {
        user = await kc.createUser({
          verifiId: session.verifiId,
          firstName: first,
          lastName: last,
          email,
        });
      }
      // Portal-Identität sicherstellen (ADR-001) — idempotent, falls der
      // Verimi-Callback bereits geschrieben hat.
      upsertIdentity(db, { verifiId: session.verifiId, firstName: first, lastName: last, email });
      // Registrierung für ein Konto, das bereits einen Passkey hat, ist kein Fehler
      // im Sinne des Ablaufs — der Nutzer landet direkt im geschützten Bereich.
      const creds = await kc.listCredentials(user.id);
      const already = kc.hasWebAuthnCredential(creds);
      if (!already) {
        await kc.setRequiredAction(user.id, 'webauthn-register-passwordless');
      }
      // Variante A (KC 26.7): Impersonation erzeugt eine Keycloak-Session und setzt
      // das SSO-Cookie auf die Admin-API-Antwort — wir reichen die Header an den
      // Browser weiter (host-only „localhost"-Cookie, gilt für 8082 mit).
      const imp = already ? null : await kc.impersonate(user.id);
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
      return json(res, 201, {
        registration_id: registrationId,
        ceremony: {
          mode: already ? 'keycloak-sso' : 'keycloak-required-action',
          redirect_to: `${cfg.publicBaseUrl}/api/auth/kc/start?context=register`,
        },
      });
    } catch (err) {
      console.warn('[api-03] Fehler:', err.message);
      return json(res, 500, { message: 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' });
    }
  });

  // -------------------------------------------------------------------------
  // Prototyp-intern: Keycloak-Auth starten (Phase-2-Login, Passkey-Login, Registrierung)
  // -------------------------------------------------------------------------
  r.get('/api/auth/kc/start', async (req, res) => {
    // Keycloak-Erreichbarkeit VOR der Browser-Weiterleitung prüfen: sonst würde
    // der Browser auf der Keycloak-Fehlerseite landen. Dieser Endpunkt ist der
    // zentrale Durchlaufpunkt ALLER Keycloak-Einstiege (Phase-2-Login,
    // „Passkey Login" und die Registrierung).
    if (!(await isReachable(kcProbeUrl))) {
      return res.redirect('/?v=error&m=auth');
    }
    const context = ['login', 'register'].includes(String(req.query.context)) ? String(req.query.context) : 'login';
    let session = getSession(parseCookies(req)[cookieName]);

    if (context === 'login' && (!session || !session.verifiId)) {
      // Passkey-Login ohne vorherige Verimi-Session: anonyme Session für den OIDC-Lauf
      session = createSession(null, null);
      setSessionCookie(res, session.sid);
    }

    if (context === 'register' && (!session || !session.kcAuth || session.kcAuth.context !== 'register')) {
      return res.redirect('/?v=error&m=registration');
    }

    const verifier = randomBytes(48).toString('base64url');
    session.kcAuth = {
      context,
      kcUserId: session.kcAuth?.kcUserId ?? null,
      registrationId: session.kcAuth?.registrationId ?? null,
      verifier,
    };
    // Registrierung läuft über den Bootstrap-Client (Standard-browser-Flow,
    // damit die Pflicht-Aktion ohne Passkey-Login erreichbar ist).
    const clientId = context === 'register' ? cfg.bootstrapClientId : cfg.clientId;
    const url = kc.buildAuthUrl(session.sid, verifier, clientId);
    res.redirect(url);
  });

  // -------------------------------------------------------------------------
  // Prototyp-intern: OIDC-Callback (Redirect-Ziel von Keycloak)
  // -------------------------------------------------------------------------
  r.get('/api/auth/kc/callback', async (req, res) => {
    const sid = String(req.query.state ?? '');
    const session = getSession(sid);
    if (!session || !session.kcAuth?.verifier) {
      return res.redirect('/?v=error&m=login-failed');
    }

    const fail = async (reason, detail) => {
      logEvent(db, {
        eventType: 'login_failed',
        result: 'failure',
        reference: session.verifiId ? refOf(session.verifiId) : null,
        detail,
      });
      res.redirect(reason === 'foreign' ? '/?v=error&m=foreign' : '/?v=error&m=login-failed');
    };

    try {
      if (req.query.error) return fail('error', `Keycloak-Fehler: ${req.query.error}`);
      const exchangeClientId =
        session.kcAuth.context === 'register' ? cfg.bootstrapClientId : cfg.clientId;
      const { payload, idToken } = await kc.exchangeCodeAndVerify(
        String(req.query.code),
        session.kcAuth.verifier,
        exchangeClientId
      );
      session.kcAuth.verifier = null; // Einmalgebrauch
      // id_token für den späteren OIDC-Logout (id_token_hint) merken; nur so
      // überspringt Keycloak beim Abmelden die Bestätigungsseite.
      if (idToken) session.idToken = idToken;

      const context = session.kcAuth.context || 'login';

      if (context === 'register') {
        if (payload.sub !== session.kcAuth.kcUserId) {
          return fail('foreign', 'Fremde Session bei Registrierung');
        }
        try {
          await kc.setAttribute(session.kcAuth.kcUserId, 'passkey_registered', 'true');
        } catch (e) {
          console.warn('[callback] Attribut setzen fehlgeschlagen:', e.message);
        }
        session.passkeyAuth = true;
        logEvent(db, { eventType: 'registration', result: 'success', reference: refOf(session.verifiId), detail: 'Passkey registriert (Keycloak Credential)' });
        // BR-16: Einmalcode bei erstmaliger Registrierung ausstellen (Prototyp)
        try {
          const { issueRecoveryCode } = await import('../recovery/store.js');
          issueRecoveryCode({ realm: cfg.realm, penr: session.verifiId, verifiId: session.verifiId });
        } catch (e) {
          console.warn('[callback] Recovery-Code-Ausstellung fehlgeschlagen:', e.message);
        }
        return res.redirect('/?v=protected');
      }

      // login / verify
      const verifiId = payload.preferred_username || session.verifiId;
      if (!VERIFI_ID_RE.test(verifiId)) return fail('error', 'Kennung im Token unerwartet');
      const user = await kc.findUserByVerifiId(verifiId);
      if (!user || user.id !== payload.sub) return fail('foreign', 'Token-Subject passt nicht zur Kennung');

      // Anzeigename kommt aus der Portal-DB (portal_identity, ADR-001). Beim
      // reinen Passkey-Login ohne vorherige Verimi-Anmeldung fehlt der Datensatz
      // ggf. noch → aus dem Keycloak-Profil nachtragen (Keycloak ist die
      // autoritative Identitätsquelle). Kein Schreiben ins Prefill mehr.
      if (!getIdentity(db, verifiId)) {
        upsertIdentity(db, {
          verifiId,
          firstName: user.firstName || payload.given_name || '',
          lastName: user.lastName || payload.family_name || '',
          email: user.email || payload.email || '',
        });
      }

      session.verifiId = verifiId;
      session.passkeyAuth = true;
      logEvent(db, { eventType: 'login_success', result: 'success', reference: refOf(verifiId) });
      return res.redirect('/?v=protected');
    } catch (err) {
      console.warn('[callback] Fehler:', err.message);
      return fail('error', 'Token-Prüfung fehlgeschlagen');
    }
  });

  // -------------------------------------------------------------------------
  // API-04  GET /api/session — geschützter Bereich
  // -------------------------------------------------------------------------
  r.get('/api/session', (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    if (!session) return json(res, 401, { message: 'Bitte melden Sie sich an.' });

    if (session.passkeyAuth) {
      const phase = readPhase();
      return json(res, 200, {
        display_name: displayNameOf(session.verifiId),
        phase: phase.phase,
        passkey: true,
      });
    }

    // Phase 1: Verimi-Authentifizierung genügt für den geschützten Bereich (FR-12/AC-P2).
    const phase = readPhase();
    if (phase.phase === 'phase1' && session.verifiId) {
      return json(res, 200, {
        display_name: displayNameOf(session.verifiId),
        phase: phase.phase,
        passkey: false,
      });
    }

    // Phase 2 ohne gültiges Token → Sperrung 'mangels Passkey' (BE-07, FR-44, AC-3)
    if (!session.blockedLogged) {
      logEvent(db, {
        eventType: 'blocked',
        result: 'failure',
        reference: session.verifiId ? refOf(session.verifiId) : null,
        detail: 'mangels Passkey',
      });
      session.blockedLogged = true;
    }
    return json(res, 403, { message: 'Die Anmeldung ist derzeit nicht möglich.' });
  });

  // -------------------------------------------------------------------------
  // Prototyp-intern: Abmelden — beendet ALLE beteiligten Sessions (Issue 2):
  //   1) Portal-Session + Cookie (dieser Server)
  //   2) Keycloak-SSO-Session des Nutzers (OIDC RP-Initiated Logout bzw. Admin-API)
  //   3) Verimi-SSO-Session — NUR falls die Session über Verimi entstand
  //      (session.viaVerimi) und Verimi erreichbar ist.
  // Erst danach ist ein erneuter Login wieder zugangsdaten-pflichtig. Ohne die
  // SSO-Revocation würde ein Klick auf „Anmelden" über die bestehende
  // Verimi-/Keycloak-Session OHNE Credentials direkt in den geschützten Bereich
  // führen (Auth-Bypass).
  //
  // Robustheit (ADR-002): Der Rücksprung zur Portal-Startseite ist portal-eigen
  // und hängt NICHT von Verimi ab. Die Verimi-Abmeldung ist eine optionale
  // Zwischenstation; ist Verimi nicht erreichbar, landet der Browser trotzdem
  // auf der Startseite. Ohne diese Entkopplung blieb der Browser bei
  // abgeschaltetem Verimi auf http://localhost:8081/logout?... stehen.
  // -------------------------------------------------------------------------

  // Verimi-SSO-Abmeldung: Rückleitung an die Portal-Startseite. Der Verimi-Mock
  // leitet nur an den Portal-Origin zurück (verimi-mock/server.js:162–178).
  const verimiLogoutRedirect = () =>
    `${cfg.verimiLogoutUrl}?redirect=${encodeURIComponent(`${cfg.publicBaseUrl}/`)}`;

  // Verimi nur dann im Browser ansteuern, wenn der Dienst erreichbar ist — sonst
  // würde der Browser auf der Verimi-Fehlerseite landen. Server-seitige Prüfung
  // über den Container-DNS-Namen (Docker) bzw. localhost (nativ), vgl. API-01.
  async function verimiLogoutOrHome() {
    const up = await isReachable(cfg.verimiInternalUrl);
    return up ? verimiLogoutRedirect() : `${cfg.publicBaseUrl}/`;
  }

  const handleLogout = async (req, res) => {
    const session = getSession(parseCookies(req)[cookieName]);
    let idToken = null;
    let verifiId = null;
    let viaVerimi = false;
    if (session) {
      idToken = session.idToken ?? null;
      verifiId = session.verifiId ?? null;
      viaVerimi = session.viaVerimi === true;
      deleteSession(session.sid);
      // Fallback OHNE id_token (z. B. reine Verimi-Session in Phase 1): Keycloak
      // würde dann nur mit `client_id` eine Bestätigungsseite zeigen. Deshalb die
      // KC-Session(en) serverseitig per Admin-API beenden.
      if (!idToken && verifiId) {
        try {
          const user = await kc.findUserByVerifiId(verifiId);
          if (user?.id) await kc.logoutUser(user.id);
        } catch (err) {
          console.warn('[logout] Keycloak-Session-Revocation fehlgeschlagen:', err.message);
        }
      }
    }
    // Portal-Cookie in jedem Fall löschen (auch ohne/zusätzlich zur Session).
    res.setHeader('set-cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);

    if (!isBrowser(req)) return res.json({ ok: true });

    // Browser-Navigation (ADR-002): Der Abschluss ist IMMER eine Portal-Route.
    // - Mit id_token: OIDC RP-Initiated Logout; Keycloak beendet die SSO-Session
    //   und leitet an eine Portal-Route zurück (`id_token_hint` verhindert die
    //   Keycloak-Logout-Bestätigungsseite). Ziel richtet sich nach der Herkunft.
    // - Ohne id_token: KC bereits per Admin-API beendet → direkt navigieren.
    if (idToken) {
      const postLogoutRedirectUri = viaVerimi
        ? `${cfg.publicBaseUrl}/logout/verimi`
        : `${cfg.publicBaseUrl}/logout/done`;
      return res.redirect(kc.buildLogoutUrl({ idTokenHint: idToken, postLogoutRedirectUri }));
    }
    return res.redirect(viaVerimi ? await verimiLogoutOrHome() : `${cfg.publicBaseUrl}/`);
  };
  r.get('/api/logout', handleLogout);
  r.post('/api/logout', handleLogout);

  // Verimi-Fall: nach dem Keycloak-Logout noch die Verimi-SSO beenden — aber nur,
  // wenn Verimi erreichbar ist; sonst direkt zur Startseite.
  r.get('/logout/verimi', async (req, res) => res.redirect(await verimiLogoutOrHome()));

  // Nicht-Verimi-Fälle (reiner Passkey-/Phase-2-Login): portal-eigener Abschluss.
  r.get('/logout/done', (req, res) => res.redirect('/'));

  app.use(r);
};