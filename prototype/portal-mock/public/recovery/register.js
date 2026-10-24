(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const waitCrossOrigin = (w, maxMs) =>
    new Promise((resolve) => {
      const started = Date.now();
      const iv = setInterval(() => {
        let throws = false;
        try { void w.location.href; } catch { throws = true; }
        if (throws || Date.now() - started > maxMs) { clearInterval(iv); resolve(); }
      }, 150);
    });

  const btn = $('btn-recover-reg');
  const hint = $('recovery-reg-hint');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const w = window.open('', 'kcHandoff');
    if (!w) {
      hint.textContent = 'Bitte erlauben Sie Pop-up-Fenster für diese Seite und versuchen Sie es erneut.';
      hint.hidden = false;
      return;
    }
    btn.disabled = true;
    hint.hidden = false;
    hint.textContent = 'Bitte schließen Sie die Anmeldung am Gerät ab.';

    try {
      const res = await fetch('/api/recovery/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        w.close();
        btn.disabled = false;
        hint.textContent = 'Wiederherstellung fehlgeschlagen. Bitte starten Sie den Vorgang erneut.';
        return;
      }
      const { ceremony } = await res.json();
      const sameOrigin =
        ceremony.redirect_to.startsWith('/') ||
        ceremony.redirect_to.startsWith(`${location.origin}/`);
      if (ceremony.mode === 'keycloak-sso' || sameOrigin) {
        w.close();
        location.assign(ceremony.redirect_to);
        return;
      }
      w.location.assign(ceremony.redirect_to);
      await waitCrossOrigin(w, 6000);
      try { w.close(); } catch {}
      location.assign('/api/auth/kc/start?context=register');
    } catch {
      w.close();
      btn.disabled = false;
      hint.textContent = 'Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.';
    }
  });
})();
