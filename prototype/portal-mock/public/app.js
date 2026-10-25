/**
 * Kundenportal-Prototyp — Frontend-Logik.
 *
 * Regeln (technical-spec §3, Stand 2026-10-08):
 * - zwei Login-Einstiege (Entscheidung Projektträger): „Anmelden" (Verimi/Phase-
 *   Schalter) und „Passkey Login" (direkter Keycloak-Passkey-Flow); ursprünglich
 *   FR-03 „genau ein Einstiegspunkt" damit geändert
 * - Registrierungsfrage bei jedem Login bis zur Registrierung (NFR-UX-04)
 * - Formular: drei vorbefüllte, readonly Felder (FR-13/FR-14)
 * - Fehlermeldungen: verständlich, ohne Fehlercode (FR-35)
 * - keine Fachdaten im geschützten Bereich (nur Name, C-P.1)
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const views = ['login', 'question', 'register', 'protected', 'blocked', 'error', 'unsupported', 'recovery', 'recovery-code'];
  const show = (name) => {
    for (const v of views) {
      const el = $(`view-${v}`);
      if (el) el.hidden = v !== name; // 'protected' existiert erst nach Autorisierung
    }
    $('main').focus();
  };

  const params = new URLSearchParams(location.search);

  // --- Browser-Eignung (ERR-04 / NFR-Env-04) -------------------------------
  if (typeof window.PublicKeyCredential === 'undefined') {
    show('unsupported');
    return;
  }

  // --- Texte (T-19: deutsche, jargonfreie Meldungen) -----------------------
  const ERROR_TEXTS = {
    login: 'Die Anmeldung war nicht erfolgreich. Bitte versuchen Sie es erneut.',
    'login-failed': 'Die Anmeldung war nicht erfolgreich. Bitte versuchen Sie es erneut.',
    invalid: 'Die Anmeldung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    foreign: 'Die Anmeldung konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    registration: 'Die Einrichtung konnte nicht fortgesetzt werden. Bitte starten Sie erneut.',
    service: 'Der Dienst ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.',
    // Verimi-Anmeldedienst nicht erreichbar (Vorprüfung in API-01). Ohne diese
    // Meldung würde der Browser auf der Verimi-Fehlerseite landen.
    auth: 'Die Anmeldung ist derzeit nicht möglich, da der Anmeldedienst momentan nicht erreichbar ist. Bitte versuchen Sie es zu einem späteren Zeitpunkt erneut.',
    generic: 'Das hat leider nicht geklappt. Bitte versuchen Sie es erneut.',
  };

  const showError = (key) => {
    $('error-text').textContent = ERROR_TEXTS[key] || ERROR_TEXTS.generic;
    show('error');
  };

  // --- Login-Einstieg -------------------------------------------------------
  $('btn-login').addEventListener('click', async () => {
    $('btn-login').disabled = true;
    $('login-hint').hidden = false;
    try {
      // Accept: application/json → der Server antwortet im Fehlerfall mit JSON
      // (inkl. `reason`), statt uns per Redirect auf die Fehlerseite zu schicken.
      // So können wir „Anmeldedienst nicht erreichbar" gezielt melden.
      const res = await fetch('/api/auth/start', { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.redirect_url) {
        $('btn-login').disabled = false;
        $('login-hint').hidden = true;
        // reason='auth' → Verimi nicht erreichbar (Vorprüfung in API-01)
        return showError(data?.reason === 'auth' ? 'auth' : 'service');
      }
      location.assign(data.redirect_url);
    } catch {
      $('btn-login').disabled = false;
      $('login-hint').hidden = true;
      showError('service');
    }
  });

  // --- Passkey-Login (Direkteinstieg, Entscheidung 2026-10-08) ----------------
  // Geht direkt in den Keycloak-Passkey-Flow (username-los) — funktioniert ohne
  // vorherige Verimi-Session (anonyme Session, s. /api/auth/kc/start context=login).
  $('btn-passkey').addEventListener('click', () => {
    $('btn-passkey').disabled = true;
    $('login-hint').hidden = false;
    location.assign('/api/auth/kc/start?context=login');
  });

  // --- Passkey-Recovery (FR-100) -------------------------------------------
  const btnRec = $('btn-recovery');
  if (btnRec) {
    btnRec.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      show('recovery');
    });
  } else {
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'btn-recovery') {
        e.preventDefault();
        show('recovery');
      }
    });
  }
  if ($('btn-recovery-cancel')) {
    $('btn-recovery-cancel').addEventListener('click', () => {
      show('login');
    });
  }
  if ($('recovery-form')) {
    $('recovery-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('btn-recovery-start');
      const hint = $('recovery-hint');
      btn.disabled = true;
      hint.hidden = false;
      hint.textContent = 'Überprüfung...';
      try {
        const res = await fetch('/api/recovery/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            realm: $('r-realm').value.trim(),
            penr: $('r-penr').value.trim(),
            code: $('r-code').value.trim(),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.redirect_url) {
          btn.disabled = false;
          hint.textContent = data?.message || 'Die Angaben konnten nicht verarbeitet werden. Bitte versuchen Sie es erneut.';
          return;
        }
        location.assign(data.redirect_url);
      } catch {
        btn.disabled = false;
        hint.textContent = 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.';
      }
    });
  }

  // --- Einmalcode nach der Passkey-Registrierung (BR-16, FR-102) ------------
  // Der Code wird vom Server nur einmal ausgestellt und in der Session gehalten.
  // Diese Ansicht zeigt PENR + Einmalcode an, bis der Nutzer bestätigt, ihn
  // gespeichert zu haben — erst dann geht es in den geschützten Bereich.
  const showRecoveryCode = async () => {
    try {
      const res = await fetch('/api/recovery/pending-code');
      if (res.status === 401) return show('login');
      // 404 = kein ausstehender Code (z. B. bereits bestätigt) → normal weiter.
      if (res.status === 404) return loadSession();
      if (!res.ok) return showError('service');
      const data = await res.json();
      $('rc-penr').value = data.penr;
      $('rc-code').value = data.code;
      show('recovery-code');
    } catch {
      showError('service');
    }
  };

  const btnCodeAck = $('btn-recovery-code-ack');
  if (btnCodeAck) {
    btnCodeAck.addEventListener('click', async () => {
      const hint = $('recovery-code-hint');
      btnCodeAck.disabled = true;
      hint.hidden = false;
      hint.textContent = 'Einen Moment …';
      try {
        const res = await fetch('/api/recovery/pending-code/ack', { method: 'POST' });
        if (!res.ok) throw new Error('Bestätigung fehlgeschlagen');
        location.replace('/?v=protected');
      } catch {
        btnCodeAck.disabled = false;
        hint.textContent = 'Der Code konnte nicht bestätigt werden. Bitte versuchen Sie es erneut.';
      }
    });
  }

  // --- Registrierungsfrage ---------------------------------------------------
  const initQuestion = async () => {
    try {
      const res = await fetch('/api/auth/prefill');
      if (!res.ok) return showError('generic');
      const { prefill } = await res.json();
      $('f-last').value = prefill.last_name;
      $('f-first').value = prefill.first_name;
      $('f-email').value = prefill.email;
      show('question');
    } catch {
      showError('generic');
    }
  };

  $('btn-no').addEventListener('click', () => {
    // "Nein" → ohne Fehlermeldung, ohne Sperrhinweis in den geschützten Bereich (AC-P2)
    location.assign('/auth/decision/no');
  });

  $('btn-yes').addEventListener('click', () => show('register'));

  // --- Registrierungsformular ------------------------------------------------
  let pendingCeremony = null; // { w, redirectTo }

  const waitCrossOrigin = (w, maxMs) =>
    new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        let throws = false;
        try { void w.location.href; } catch { throws = true; }
        if (throws || Date.now() - started > maxMs) { clearInterval(iv); resolve(); }
      }, 150);
    });

  const startCeremony = async (body) => {
    // Popup synchron im Klick-Handler öffnen (Pop-up-Blocker).
    const w = window.open('', 'kcHandoff');
    if (!w) {
      pendingCeremony = { w: null, redirectTo: null };
      $('register-hint').textContent =
        'Bitte erlauben Sie Pop-up-Fenster für diese Seite und versuchen Sie es erneut.';
      $('register-hint').hidden = false;
      $('btn-register').disabled = false;
      return;
    }

    $('btn-register').disabled = true;
    $('register-hint').hidden = false;
    $('register-hint').textContent = 'Bitte schließen Sie die Anmeldung am Gerät ab.';

    let res;
    try {
      res = await fetch('/api/registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      w.close();
      $('btn-register').disabled = false;
      $('register-hint').hidden = true;
      showError('generic');
      return;
    }

    if (!res.ok) {
      w.close();
      $('btn-register').disabled = false;
      $('register-hint').hidden = true;
      if (res.status === 401) return location.assign('/');
      return showError('generic');
    }

    const { ceremony } = await res.json();

    // Variante A (KC 26.7): Das SSO-Cookie kam bereits per Set-Cookie-Header mit
    // der Registrierungsantwort mit → der Haupt-Tab kann direkt in den
    // Keycloak-Flow (gleiche-Origin-Weiterleitung). Ein echter Kreuz-Origin-
    // Handoff (Popup) bleibt als Fallback möglich.
    const sameOrigin =
      ceremony.redirect_to.startsWith('/') ||
      ceremony.redirect_to.startsWith(`${location.origin}/`);
    if (ceremony.mode === 'keycloak-sso' || sameOrigin) {
      w.close();
      location.assign(ceremony.redirect_to);
      return;
    }

    // Impersonation-URL im Popup öffnen → Keycloak-Session entsteht → danach
    // Haupt-Tab in den Keycloak-Auth-Flow (Pflicht-Aktion Passkey-Registrierung).
    w.location.assign(ceremony.redirect_to);
    await waitCrossOrigin(w, 6000);
    try { w.close(); } catch { /* Popup ist schon weg */ }
    location.assign('/api/auth/kc/start?context=register');
  };

  $('register-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    startCeremony({
      first_name: $('f-first').value.trim(),
      last_name: $('f-last').value.trim(),
      email: $('f-email').value.trim(),
    });
  });

  // --- Geschützter Bereich --------------------------------------------------
  // Der geschützte Bereich existiert NICHT im statischen Dokument; er wird erst
  // nach erfolgreicher Autorisierung (/api/session) aus der Vorlage erzeugt
  // (Issue 3). Damit liegt kein geschützter Inhalt/PII im cachebaren HTML bzw.
  // im DOM, solange nicht autorisiert ist.
  const onLogout = () => {
    // PII sofort aus dem DOM entfernen (Defense-in-Depth gegen bfcache-Restore).
    const nameEl = $('protected-name');
    if (nameEl) nameEl.textContent = '';
    // Der Server beendet Portal- UND Upstream-SSO-Session (Keycloak/Verimi) und
    // leitet über den Verimi-Logout zurück zur Startseite (Issue 2). 'replace'
    // entfernt die geschützte Seite aus der History → kein Back-Button-Rest.
    location.replace('/api/logout');
  };

  const ensureProtectedView = () => {
    if ($('view-protected')) return;
    const node = $('tpl-protected').content.cloneNode(true);
    $('main').appendChild(node);
    $('btn-logout').addEventListener('click', onLogout);
  };

  const loadSession = async () => {
    try {
      const res = await fetch('/api/session');
      if (res.status === 401) {
        // Nicht (mehr) autorisiert: ggf. vorhandenen v-Parameter bereinigen.
        if (location.search.includes('v=protected')) {
          history.replaceState(null, '', '/');
        }
        return show('login');
      }
      if (res.status === 403) return show('blocked');
      if (!res.ok) return showError('service');
      const data = await res.json();
      ensureProtectedView();
      $('protected-name').textContent = `Angemeldet als ${data.display_name}`;
      show('protected');
    } catch {
      showError('service');
    }
  };

  $('btn-blocked-back').addEventListener('click', () => location.assign('/'));
  $('btn-error-back').addEventListener('click', () => location.assign('/'));

  // --- Schutz gegen Browser-History/bfcache (Issue 1) ------------------------
  // Bei einem Restore aus dem Back/Forward-Cache führt der Browser das Skript
  // NICHT erneut aus. Deshalb hier die Autorisierung frisch prüfen — sonst
  // bliebe ein zuvor gerenderter geschützter Bereich sichtbar.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const vv = new URLSearchParams(location.search).get('v');
    if (vv === 'protected') loadSession();
    else if (vv === 'question') initQuestion();
  });

  // Beim Verlassen/Wegcachen PII aus dem DOM entfernen und den geschützten
  // Bereich ausblenden, damit auch ein bfcache-Restore ihn nicht kurz zeigt.
  window.addEventListener('pagehide', () => {
    const nameEl = $('protected-name');
    if (nameEl) nameEl.textContent = '';
    const protectedView = $('view-protected');
    if (protectedView) protectedView.hidden = true;
  });

  // --- Initiale Ansicht ------------------------------------------------------
  const v = params.get('v');
  if (v === 'question') initQuestion();
  else if (v === 'protected') loadSession();
  else if (v === 'recovery-code') showRecoveryCode();
  else if (v === 'blocked') show('blocked');
  else if (v === 'error') showError(params.get('m') || 'generic');
  else show('login');
})();