/**
 * Keycloak-Anbindung des Portal-Backends (Admin-REST + OIDC).
 *
 * - Admin-Zugang über Service-Account-Client `portal-admin` (client_credentials).
 * - OIDC Authorization Code + PKCE (S256) beim Client `portal-mock`.
 * - Token-Prüfung serverseitig: Aussteller, Signatur (JWKS), Zielgruppe, Laufzeit.
 */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cfg } from './config.js';

let adminToken = null; // { access_token, expires_at }

async function adminAccessToken() {
  if (adminToken && Date.now() < adminToken.expires_at - 30_000) {
    return adminToken.access_token;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.adminClientId,
    client_secret: cfg.adminClientSecret,
  });
  const res = await fetch(
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`,
    { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Keycloak Admin-Token fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  adminToken = {
    access_token: data.access_token,
    expires_at: Date.now() + Number(data.expires_in || 60) * 1000,
  };
  return adminToken.access_token;
}

async function adminApi(method, pathname, body) {
  const token = await adminAccessToken();
  const res = await fetch(`${cfg.keycloakUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* kein JSON */
  }
  if (!res.ok) {
    const err = new Error(`Keycloak Admin ${method} ${pathname} → ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return json;
}

// --- Nutzer ---------------------------------------------------------------

export async function findUserByVerifiId(verifiId) {
  const list = await adminApi(
    'GET',
    `/admin/realms/${cfg.realm}/users?username=${encodeURIComponent(verifiId)}&exact=true`
  );
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

export async function createUser({ verifiId, firstName, lastName, email }) {
  await adminApi('POST', `/admin/realms/${cfg.realm}/users`, {
    username: verifiId,
    enabled: true,
    emailVerified: true,
    firstName,
    lastName,
    email,
    attributes: { verifi_id: [verifiId] },
  });
  return findUserByVerifiId(verifiId);
}

/** Credential-Liste eines Nutzers (enthält z. B. den Passkey, Typ webauthn-*). */
export async function listCredentials(userId) {
  try {
    return await adminApi('GET', `/admin/realms/${cfg.realm}/users/${userId}/credentials`);
  } catch {
    return null; // Endpoint nicht verfügbar → Aufrufer nutzt Fallback (Attribut)
  }
}

export function hasWebAuthnCredential(credentials) {
  return Array.isArray(credentials) && credentials.some((c) => String(c.type || '').startsWith('webauthn'));
}

/**
 * Entfernt ein Credential (z. B. einen alten/verlorenen Passkey) über die
 * Admin-API. Beim Recovery wird der alte Passkey VOR der Neu-Registrierung
 * widerrufen: Keycloak verweigert sonst die Registrierung mit demselben
 * Credential-Namen ("Device already exists with the same name").
 */
export async function deleteCredential(userId, credentialId) {
  await adminApi(
    'DELETE',
    `/admin/realms/${cfg.realm}/users/${userId}/credentials/${credentialId}`
  );
}

export async function setRequiredAction(userId, action) {
  const user = await adminApi('GET', `/admin/realms/${cfg.realm}/users/${userId}`);
  user.requiredActions = [...new Set([...(user.requiredActions || []), action])];
  await adminApi('PUT', `/admin/realms/${cfg.realm}/users/${userId}`, user);
}

export async function setAttribute(userId, name, value) {
  const user = await adminApi('GET', `/admin/realms/${cfg.realm}/users/${userId}`);
  user.attributes = { ...(user.attributes || {}), [name]: [String(value)] };
  await adminApi('PUT', `/admin/realms/${cfg.realm}/users/${userId}`, user);
}

/**
 * Beendet ALLE Keycloak-Session(s) (SSO) eines Nutzers serverseitig
 * (Admin-API, benötigt `manage-users`). Wird beim Portal-Logout aufgerufen,
 * damit die Keycloak-SSO-Session nicht als stiller Re-Login-Pfad bestehen
 * bleibt. Ohne diese Revocation würde ein Klick auf „Anmelden" z. B. über den
 * SSO-Cookie-Flow des Browsers erneut authentifizieren (Auth-Bypass, Issue 2).
 */
export async function logoutUser(userId) {
  await adminApi('POST', `/admin/realms/${cfg.realm}/users/${userId}/logout`);
}

/**
 * Impersonation (Variante A, KC 26.7):
 * Erzeugt serverseitig eine Keycloak-Session für den Nutzer. Keycloak setzt
 * dabei das SSO-Cookie (KEYCLOAK_IDENTITY) AUF DIE ADMIN-API-ANTWORT — der
 * Browser bekommt es über Server-zu-Server sonst nicht. Der Aufrufer (Portal)
 * reicht diese Set-Cookie-Header an den Browser weiter („SSO-Cookie-Relay"):
 * Das Cookie ist host-only für „localhost" (Ports spielen für Cookies keine
 * Rolle) und wird vom Browser bei 8082 mitgeschickt.
 */
export async function impersonate(userId) {
  const token = await adminAccessToken();
  const res = await fetch(
    `${cfg.keycloakUrl}/admin/realms/${cfg.realm}/users/${userId}/impersonation`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` } }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Impersonation fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = JSON.parse(text);
  if (!body || !body.redirect) {
    throw new Error('Impersonation ohne Redirect-Antwort von Keycloak');
  }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { redirect: body.redirect, setCookies };
}

export async function listUsers(first = 0, max = 200) {
  const list = await adminApi(
    'GET',
    `/admin/realms/${cfg.realm}/users?first=${first}&max=${max}`
  );
  return Array.isArray(list) ? list : [];
}

// --- OIDC / Token ---------------------------------------------------------

const jwks = createRemoteJWKSet(
  new URL(`${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/certs`)
);

/**
 * Prüft ein Access-Token serverseitig (BE-08/FR-32, AC-P6):
 * Signatur über JWKS, Aussteller, Ablaufzeit (jose) — plus Client-Bindung.
 *
 * Client-Bindung: Die robuste Quelle ist `azp` (authorized party), das KC aus
 * `issuedFor(client.getClientId())` setzt — also dem Client des Token-Requests.
 * `aud` ist bei SSO-Resume-Sessions (Impersonation → Pflicht-Aktion) von KC 26.7
 * mitunter auf die Ursprungs-Audience (z. B. "account") RESTRIKTIERT (siehe
 * TokenManager.restrictRequestedAudience) und dann nicht nutzbar. `azp` bleibt
 * dabei korrekt. Wir verlangen deshalb: azp ∈ {Portal-Clients} UND — sofern
 * `aud` unsere Clients enthält — konsistent.
 */
export async function verifyAccessToken(token) {
  // Issuer-Check gegen die Frontend-URL: Keycloak prägt den Token-Issuer aus
  // seiner (per --hostname gesetzten) öffentlichen URL — in Docker ist das
  // `http://localhost:8082` (Browser-Sicht), NICHT der interne DNS-Name.
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${cfg.keycloakPublicUrl}/realms/${cfg.realm}`,
  });
  const allowed = [cfg.clientId, cfg.bootstrapClientId];
  if (!allowed.includes(payload.azp)) {
    throw new Error(`unexpected "azp" claim value`);
  }
  const aud = payload.aud;
  const audMatchesInherited = aud === undefined || aud === payload.azp;
  const audContainsOurs =
    (Array.isArray(aud) && aud.some((a) => allowed.includes(a))) ||
    (typeof aud === 'string' && allowed.includes(aud));
  // KC-26.7-Artefakt: Bei SSO-Resume-Sessions (Impersonation → Pflicht-Aktion)
  // kann TokenManager.restrictRequestedAudience aud auf Fremd-Audiences (hier:
  // "account") beschneiden, obwohl azp korrekt unseren Client nennt. Übernahme
  // sowohl als String ("account") als auch als Element eines Arrays.
  const audIsKcArtifact =
    aud === 'account' ||
    (Array.isArray(aud) &&
      aud.length > 0 &&
      aud.every((a) => a === 'account' || allowed.includes(a)));
  if (!audMatchesInherited && !audContainsOurs && !audIsKcArtifact) {
    throw new Error(`unexpected "aud" claim value`);
  }
  return payload;
}

/**
 * Authorization-Code austauschen (PKCE) und Token serverseitig prüfen.
 * Liefert { payload, rawToken }. `clientId` ist der Client, der den Flow
 * gestartet hat (portal-mock oder portal-bootstrap bei der Registrierung).
 */
export async function exchangeCodeAndVerify(code, verifier, clientId = cfg.clientId) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: `${cfg.publicBaseUrl}/api/auth/kc/callback`,
    code_verifier: verifier,
  });
  const res = await fetch(
    `${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`,
    { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Code-Austausch fehlgeschlagen (${res.status})`);
  }
  const data = await res.json();
  const payload = await verifyAccessToken(data.access_token);
  // id_token wird für den OIDC-Logout (id_token_hint) benötigt: nur damit
  // überspringt Keycloak die Logout-Bestätigungsseite (RP-Initiated Logout).
  return { payload, rawToken: data.access_token, idToken: data.id_token ?? null };
}

/** Keycloak-Anmelde-URL (PKCE-S256) — der Browser wird hierhin umgeleitet. */
export function buildAuthUrl(state, verifier, clientId = cfg.clientId) {
  const u = new URL(`${cfg.keycloakPublicUrl}/realms/${cfg.realm}/protocol/openid-connect/auth`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('redirect_uri', `${cfg.publicBaseUrl}/api/auth/kc/callback`);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url')
  );
  return u.toString();
}

/**
 * Keycloak-Abmelde-URL (OIDC RP-Initiated Logout).
 *
 * WICHTIG: `id_token_hint` MUSS das id_token der laufenden Browser-Session sein.
 * Nur dann überspringt Keycloak (26.2+, strikt nach Spec) die Logout-
 * Bestätigungsseite und leitet automatisch an `post_logout_redirect_uri` weiter.
 * Ohne `id_token_hint` (nur `client_id`) rendert Keycloak eine Bestätigungsseite —
 * für automatisierte/browserlose Flows ungeeignet.
 *
 * `postLogoutRedirectUri` muss exakt einem Eintrag in `postLogoutRedirectUris`
 * des Clients entsprechen (siehe setup-realm.mjs).
 */
export function buildLogoutUrl({ idTokenHint, postLogoutRedirectUri, clientId = cfg.clientId } = {}) {
  const u = new URL(
    `${cfg.keycloakPublicUrl}/realms/${cfg.realm}/protocol/openid-connect/logout`
  );
  if (idTokenHint) u.searchParams.set('id_token_hint', idTokenHint);
  else u.searchParams.set('client_id', clientId);
  if (postLogoutRedirectUri) u.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  return u.toString();
}