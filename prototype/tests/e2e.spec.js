/**
 * E2E-Abnahmetests (Playwright + CDP-Virtual-Authenticator, Prototyp).
 *
 * Voraussetzungen (laufende Dienste nativ ODER per docker-compose):
 *   - portal-mock auf 8080, verimi-mock auf 8081, Keycloak auf 8082
 *   - Realm „passkey-prototyp" eingerichtet (setup-realm.mjs)
 *
 * Abgedeckte Abnahmekriterien:
 *   T1  Registrierung (Variante A: Required Action + Impersonation + SSO) → geschützter Bereich
 *   T2  Nach Logout erneuter Verimi-Login MIT Zugangsdaten → direkt geschützter Bereich
 *       (Entscheidung 2026-10-08; SSO-Revocation verhindert stillen Re-Login)
 *   T2b „Passkey Login"-Button: username-loser Passkey-Login ohne Verimi (neuer Einstieg)
 *   T2c Sicherheits-Fix: Back-Button nach Logout zeigt keinen geschützten Bereich
 *   T2d Logout nach Passkey-Login landet auf der Startseite — ohne Verimi-Kontakt (ADR-002)
 *   T3  „Nein"-Pfad: geschützter Bereich ohne Passkey, ohne Fehlermeldung (AC-P2, FR-12)
 *   T4  Phase-2-Login: username-loses WebAuthn (FR-16) — ohne Verimi
 *   T5  Sperr-Demo: Phase 2 + Nutzer ohne Passkey → 403 + Ereignis „blocked" (BE-07, FR-44, AC-3)
 *
 * Hinweise:
 *   - Ein Browser-Context mit einem CDP-Virtual-Authenticator (ctap2, resident
 *     key, user verification) trägt die Passkey-Credentials über alle Tests.
 *   - Die Tests sind aufeinander angewiesen (serial, siehe playwright.config).
 *   - Phasenwechsel (R-OPS) wird in T4 gesetzt und am Ende zurückgesetzt.
 */
import { test, expect } from '@playwright/test';

const PORTAL = 'http://localhost:8080';
const VERIMI = 'http://localhost:8081';
const KC = 'http://localhost:8082';
const REALM = 'passkey-prototyp';
const OPS_TOKEN = 'dev-rops-token';

// ---------------------------------------------------------------------------
// Helfer: Keycloak-Admin (Test-Rücksetzung, deterministische Wiederholbarkeit)
// ---------------------------------------------------------------------------
async function kcAdminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin',
    }),
  });
  if (!res.ok) throw new Error(`KC-Admin-Token: ${res.status}`);
  return (await res.json()).access_token;
}

/** Entfernt alle Passkey-Credentials eines Test-Users + Required-Action-Zustand. */
async function resetPasskeys(verifiId) {
  const tok = await kcAdminToken();
  const H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const users = await (
    await fetch(`${KC}/admin/realms/${REALM}/users?username=${encodeURIComponent(verifiId)}&exact=true`, { headers: H })
  ).json();
  const u = users?.[0];
  if (!u) return;
  const creds = await (
    await fetch(`${KC}/admin/realms/${REALM}/users/${u.id}/credentials`, { headers: H })
  ).json();
  for (const c of creds ?? []) {
    if (String(c.type).startsWith('webauthn')) {
      await fetch(`${KC}/admin/realms/${REALM}/users/${u.id}/credentials/${c.id}`, {
        method: 'DELETE',
        headers: H,
      });
    }
  }
  const full = await (
    await fetch(`${KC}/admin/realms/${REALM}/users/${u.id}`, { headers: H })
  ).json();
  full.requiredActions = (full.requiredActions ?? []).filter(
    (a) => a !== 'webauthn-register-passwordless'
  );
  if (full.attributes) delete full.attributes.passkey_registered;
  await fetch(`${KC}/admin/realms/${REALM}/users/${u.id}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify(full),
  });
}

// ---------------------------------------------------------------------------
// Helfer: Phase (R-OPS) & Ereignisprotokoll
// ---------------------------------------------------------------------------
async function setPhase(phase, reason) {
  const res = await fetch(`${PORTAL}/api/admin/phase`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${OPS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ phase, reason }),
  });
  if (res.status !== 200 && res.status !== 409) {
    throw new Error(`Phasenwechsel ${phase} fehlgeschlagen: ${res.status}`);
  }
}

async function fetchEvents() {
  const res = await fetch(`${PORTAL}/api/admin/events`, {
    headers: { authorization: `Bearer ${OPS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Events: ${res.status}`);
  return (await res.json()).events;
}

// ---------------------------------------------------------------------------
// Helfer: CDP-Virtual-Authenticator (ctap2, resident, User-Verification)
// WICHTIG (CDP-Semantik, empirisch bestätigt): Die Virtual-Authenticator-
// Umgebung ist an das TARGET der CDP-Session gebunden — sie lebt NUR auf der
// Seite, auf der 'WebAuthn.enable' + 'addVirtualAuthenticator' ausgeführt
// wurden. Deshalb wird sie an der GEMEINSAMEN FLOW-SEITE installiert, die über
// die gesamte Serie lebt und alle KC-/Portal-Navigationen durchläuft.
// ---------------------------------------------------------------------------
async function attachVirtualAuthenticator(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUserInterface: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

// ---------------------------------------------------------------------------
// Helfer: Keycloak-Passkey-Seite (Register- oder Login-Button ggf. klicken)
// ---------------------------------------------------------------------------
async function passkeyCeremony(page, maxMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const url = page.url();
    if (url.includes('8080') && (url.includes('?v=protected') || url.includes('?v=blocked') || url.includes('?v=error') || url.includes('?v=recovery-code'))) {
      return;
    }
    if (url.includes('8082')) {
      // Required Action „Passkey einrichten" (Registrierung): Button „Register"
      const reg = page.locator('#registerWebAuthn');
      if (await reg.isVisible().catch(() => false)) {
        await reg.click();
        await page.waitForTimeout(250);
        continue;
      }
      // Passkey-Login-Seite (KC 26.7): Button „Mit Sicherheitsschlüssel anmelden"
      const login = page.locator('#authenticateWebAuthnButton');
      if (await login.isVisible().catch(() => false)) {
        await login.click();
        await page.waitForTimeout(250);
        continue;
      }
      // Fallback: beliebiges Submit auf KC-Seiten („Weiter"/„Erneut versuchen")
      const anySubmit = page.locator('form button[type=submit]').first();
      if (await anySubmit.isVisible().catch(() => false)) {
        await anySubmit.click().catch(() => {});
      }
    }
    if (Date.now() - started > maxMs) throw new Error('Passkey-Zeremonie: Zeitüberschreitung');
    await page.waitForTimeout(400);
  }
}

// ---------------------------------------------------------------------------
// Serie: ein Context, ein Virtual-Authenticator, gemeinsame Credential-Geschichte
// ---------------------------------------------------------------------------
test.describe.serial('Kundenportal-Prototyp (End-to-End)', () => {
  let context;
  let page; // GEMEINSAME Flow-Seite: trägt den Virtual Authenticator (target-gebunden)
  let cdp;  // CDP-Session (WebAuthn-Domain), Referenz für Diagnosen

  test.beforeAll(async ({ browser }) => {
    // Determinismus: alle Test-User ohne Passkey starten (T1 registriert erika).
    await resetPasskeys('4f7a2c91b6d34e8fa50c1d2e3b4a5c6d'); // erika
    await resetPasskeys('9c1e5f7a2b4d6e8f0a1b2c3d4e5f6a7b'); // bob
    await resetPasskeys('2d4f6a8b0c1e3f5a7b9d0e2f4a6c8b1d'); // carol
    context = await browser.newContext({ locale: 'de-DE' });
    page = await context.newPage();
    cdp = await attachVirtualAuthenticator(page, context);
    await setPhase('phase1', 'E2E-Serie: Ausgangszustand Phase 1');
  });

  test.afterAll(async () => {
    await setPhase('phase1', 'E2E-Serie: Zurücksetzen nach Abschluss');
    await context.close();
  });

  // -------------------------------------------------------------------------
  test('T1 Registrierung: Verimi → Frage → Einrichtung → geschützter Bereich', async () => {
    // Login-Einstieg: API-01 leitet zu Verimi (Phase 1)
    await page.goto(PORTAL);
    await expect(page.locator('#view-login')).toBeVisible();
    await page.click('#btn-login');
    await page.waitForURL((u) => u.host === 'localhost:8081');

    await page.fill('#username', 'erika');
    await page.fill('#password', 'test');

    // Rückleitung an /api/auth/verimi/callback → SPA zeigt die Frage
    await Promise.all([
      page.waitForURL((u) => u.host === 'localhost:8080' && u.searchParams.get('v') === 'question'),
      page.click('button[type=submit]'),
    ]);
    await expect(page.locator('#view-question')).toBeVisible();

    // Vorbefüllte Felder (FR-13/FR-14): lesbar und gesperrt
    await page.click('#btn-yes');
    await expect(page.locator('#view-register')).toBeVisible();
    await expect(page.locator('#f-first')).toHaveValue('Erika');
    await expect(page.locator('#f-last')).toHaveValue('Mustermann');
    await expect(page.locator('#f-email')).toHaveValue('erika@example.de');
    for (const id of ['#f-first', '#f-last', '#f-email']) {
      expect(await page.locator(id).getAttribute('readonly')).not.toBeNull();
    }

    // Einrichtung: Popup (Impersonation, Kreuz-Origin) → Haupt-Tab in den
    // Keycloak-Flow (Required Action „Passkey einrichten").
    const popupPromise = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
    await page.click('#btn-register');
    const popup = await popupPromise;
    if (popup) {
      // Das SPA schließt das Popup selbst (waitCrossOrigin); wir warten nur.
      await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => {});
    }

    await passkeyCeremony(page);

    // BR-16/FR-102: Nach der Passkey-Registrierung MUSS der Einmalcode
    // angezeigt werden (unabhängig davon, wie der Passkey erzeugt wurde).
    await expect(page.locator('#view-recovery-code')).toBeVisible();
    const recoveryCode = await page.locator('#rc-code').inputValue();
    expect(recoveryCode).toMatch(/^\d{8,12}$/);
    expect(await page.locator('#rc-penr').inputValue()).toBe('4f7a2c91b6d34e8fa50c1d2e3b4a5c6d');

    // Erst nach Bestätigung ("gespeichert") geht es in den geschützten Bereich.
    await Promise.all([
      page.waitForURL((u) => u.searchParams.get('v') === 'protected'),
      page.click('#btn-recovery-code-ack'),
    ]);
    await expect(page.locator('#view-protected')).toBeVisible();
    await expect(page.locator('#protected-name')).toContainText('Erika');
  });

  // -------------------------------------------------------------------------
  test('T2 Nach Logout erneuter Verimi-Login MIT Zugangsdaten → direkt geschützter Bereich', async () => {
    // Entscheidung 2026-10-08: Verimi-Authentifizierung genügt in Phase 1 — der
    // frühere Verify-Pfad (Passkey-Abfrage nach Verimi-Login) ist entfernt.
    //
    // SICHERHEITS-FIX (Issue 2): Der Logout beendet jetzt AUCH die Verimi- und
    // die Keycloak-SSO-Session. Ein erneuter Login führt deshalb NICHT mehr per
    // SSO ohne Credentials in den geschützten Bereich, sondern verlangt wieder
    // eine Verimi-Anmeldung.
    await page.goto(`${PORTAL}/?v=protected`);
    await expect(page.locator('#btn-logout')).toBeVisible();

    // Nachweis OIDC-Logout: die Session aus T1 besitzt ein id_token, daher MUSS der
    // Abmelde-Redirect über Keycloaks end_session-Endpunkt MIT id_token_hint laufen
    // (nur dann keine Bestätigungsseite).
    const kcLogoutUrls = [];
    const onReq = (r) => {
      if (r.url().includes('/protocol/openid-connect/logout')) kcLogoutUrls.push(r.url());
    };
    page.on('request', onReq);
    await page.click('#btn-logout');
    await expect(page.locator('#view-login')).toBeVisible();
    page.off('request', onReq);
    expect(
      kcLogoutUrls.some((u) => u.includes(':8082/') && u.includes('id_token_hint=')),
      `OIDC-Logout mit id_token_hint erwartet, gesehen: ${JSON.stringify(kcLogoutUrls)}`
    ).toBe(true);

    // Erneuter Login: Verimi fragt WIEDER nach Zugangsdaten (keine SSO-Abkürzung).
    await page.click('#btn-login');
    await page.waitForURL((u) => u.host === 'localhost:8081');
    await page.fill('#username', 'erika');
    await page.fill('#password', 'test');
    await Promise.all([
      page.waitForURL((u) => u.host === 'localhost:8080' && u.searchParams.get('v') === 'protected'),
      page.click('button[type=submit]'),
    ]);
    await expect(page.locator('#view-protected')).toBeVisible();
    await expect(page.locator('#view-question')).not.toBeVisible();
    // KEINE Passkey-Abfrage (Verify-Pfad entfernt): Keycloak wurde nicht besucht.
    expect(page.url()).not.toContain('8082');

    const session = await (await page.request.get('/api/session')).json();
    expect(session.passkey).toBe(false);
    expect(session.phase).toBe('phase1');
  });

  // -------------------------------------------------------------------------
  test('T2c Sicherheits-Fix: Back-Button nach Logout zeigt keinen geschützten Bereich', async () => {
    // Angemeldet (Ende T2). Zwei geschützte History-Einträge erzeugen, damit der
    // Back-Button nach dem Logout GARANTIERT auf einen geschützten Eintrag zeigt
    // (die Suite teilt einen Context; ohne den zweiten Eintrag landete Back auf
    // der Verimi-Seite aus T2 und der Test wäre nicht deterministisch).
    await page.goto(`${PORTAL}/?v=protected`);
    await expect(page.locator('#view-protected')).toBeVisible();
    await page.goto(`${PORTAL}/?v=protected&t2c=1`); // neue URL ⇒ neuer Eintrag
    await expect(page.locator('#view-protected')).toBeVisible();

    await page.click('#btn-logout');
    await expect(page.locator('#view-login')).toBeVisible();

    // Back: der vorherige (geschützte) Eintrag darf NICHT wieder erscheinen —
    // weder aus bfcache noch per Reload. Der Login-Screen muss bleiben.
    await page.goBack();
    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#view-protected')).not.toBeVisible();
    await expect(page.locator('#view-error')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  test('T2b „Passkey Login"-Button: username-loser Passkey-Login ohne Verimi', async () => {
    // Neuer Einstieg (Entscheidung 2026-10-08): direkter Keycloak-Passkey-Flow
    // vom Login-Einstieg aus — keine Verimi-Session, kein Anbieter-Login.
    await page.context().clearCookies(); // frischer Zustand (kein SSO-Effekt)
    await page.goto(PORTAL);
    await expect(page.locator('#view-login')).toBeVisible();

    await page.click('#btn-passkey');
    await passkeyCeremony(page);
    await expect(page.locator('#view-protected')).toBeVisible();
    // Anzeigename stammt aus der Portal-DB (portal_identity, ADR-001) und ist
    // damit unabhängig vom Login-Weg → „Erika Mustermann", nicht der
    // Literal-Fallback „Angemeldet".
    await expect(page.locator('#protected-name')).toContainText('Erika Mustermann');
    // Verimi wurde NICHT aufgerufen (kein 8081-Kontakt im Passkey-Weg)
    expect(page.url()).not.toContain('8081');

    const session = await (await page.request.get('/api/session')).json();
    expect(session.passkey).toBe(true);
    expect(session.display_name).toBe('Erika Mustermann');
  });

  // -------------------------------------------------------------------------
  test('T2d Logout nach Passkey-Login landet auf der Startseite — ohne Verimi', async () => {
    // Kernanforderung (ADR-002): Der Logout ist Verimi-unabhängig. Der reine
    // Passkey-Login darf beim Abmelden KEINEN Kontakt zu Verimi (:8081) auslösen
    // und muss auf der Portal-Startseite enden (nicht auf einer Verimi-URL).
    await page.context().clearCookies();
    await page.goto(PORTAL);
    await expect(page.locator('#view-login')).toBeVisible();

    await page.click('#btn-passkey');
    await passkeyCeremony(page);
    await expect(page.locator('#view-protected')).toBeVisible();

    // Kontakt zu Verimi während des Logouts beobachten.
    const verimiHits = [];
    const onReq = (r) => {
      if (r.url().includes(':8081')) verimiHits.push(r.url());
    };
    page.on('request', onReq);
    await page.click('#btn-logout');
    await expect(page.locator('#view-login')).toBeVisible();
    page.off('request', onReq);

    // Ziel: Portal-Startseite auf :8080 — nicht :8081.
    expect(new URL(page.url()).host).toBe('localhost:8080');
    expect(
      verimiHits,
      `Kein Verimi-Kontakt beim Logout erwartet, gesehen: ${JSON.stringify(verimiHits)}`
    ).toEqual([]);

    // Portal-Session ist beendet.
    const res = await page.request.get('/api/session');
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  test('T3 „Nein"-Pfad (AC-P2): geschützter Bereich ohne Passkey, ohne Fehlertext', async () => {
    await page.context().clearCookies(); // keine Verimi-/KC-/Portal-Session mehr

    await page.goto(PORTAL);
    await page.click('#btn-login');
    await page.waitForURL((u) => u.host === 'localhost:8081');

    // bob hat keinen Passkey → Frage erscheint
    await page.fill('#username', 'bob');
    await page.fill('#password', 'test');
    await Promise.all([
      page.waitForURL((u) => u.host === 'localhost:8080' && u.searchParams.get('v') === 'question'),
      page.click('button[type=submit]'),
    ]);
    await expect(page.locator('#view-question')).toBeVisible();

    // „Nein" → geschützter Bereich (FR-12), ohne Fehlermeldung, ohne Sperrhinweis
    await page.click('#btn-no');
    await expect(page.locator('#view-protected')).toBeVisible();
    await expect(page.locator('#view-error')).not.toBeVisible();

    const session = await (await page.request.get('/api/session')).json();
    expect(session.passkey).toBe(false);
    expect(session.phase).toBe('phase1');
  });

  // -------------------------------------------------------------------------
  test('T4 Phase-2-Login: username-loses WebAuthn ohne Verimi (FR-16)', async () => {
    await setPhase('phase2', 'E2E: Passkey-Weg aktiv (T4)');
    await page.context().clearCookies(); // frischer Zustand: keine KC-/Portal-Session

    await page.goto(PORTAL);
    await expect(page.locator('#view-login')).toBeVisible();
    await page.click('#btn-login');

    // API-01 (phase2) → kc/start → Keycloak Passkey-Authentifizierung
    await passkeyCeremony(page);
    await expect(page.locator('#view-protected')).toBeVisible();
    // Verimi wurde im Phase-2-Login NICHT aufgerufen
    expect(page.url()).not.toContain('8081');
  });

  // -------------------------------------------------------------------------
  test('T5 Sperr-Demo (AC-3, BE-07): Phase 2 + Nutzer ohne Passkey → 403 + Ereignis', async () => {
    await page.context().clearCookies();

    // Direkter Verimi-Weg (carol hat keinen Passkey; Phase 2 antwortet nicht mehr
    // auf Verimi-Rückleitungen und sperrt statt zu authentifizieren).
    await page.goto(`${VERIMI}/login`);
    await page.fill('#username', 'carol');
    await page.fill('#password', 'test');
    await Promise.all([
      page.waitForURL((u) => u.host === 'localhost:8080' && u.searchParams.get('v') === 'blocked'),
      page.click('button[type=submit]'),
    ]);

    await expect(page.locator('#view-blocked')).toBeVisible();
    await expect(page.locator('#view-blocked')).toContainText('Anmeldung derzeit nicht möglich');

    // AC-3: Ursache im Ereignisprotokoll lesbar (blocked, pseudonymisiert)
    const events = await fetchEvents();
    const blocked = events.find((e) => e.event_type === 'blocked' && e.reference);
    expect(blocked, 'blocked-Ereignis mit Referenz erwartet').toBeTruthy();
    expect(blocked.reference).toMatch(/^[0-9a-f]{16}$/);
  });
});