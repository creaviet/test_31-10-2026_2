/**
 * Programmatic test for Passkey-Recovery flow (FR-100 ff.)
 * - Tests UI presence, API endpoints, realm scoping, invalid code handling
 */
import { test, expect } from '@playwright/test';

const PORTAL = process.env.PORTAL_URL || 'http://localhost:8080';
const ROPS_TOKEN = process.env.ROPS_TOKEN || 'dev-rops-token';

test.describe('Passkey Recovery Flow', () => {
  test('Login page has "Passkey verloren?" button', async ({ page }) => {
    await page.goto(PORTAL);
    await expect(page.locator('#btn-recovery')).toBeVisible();
  });

  test('Clicking "Passkey verloren?" shows recovery dialog', async ({ page }) => {
    await page.goto(PORTAL);
    await page.click('#btn-recovery');
    await expect(page.locator('#view-recovery')).toBeVisible();
    await expect(page.locator('#r-penr')).toBeVisible();
    await expect(page.locator('#r-code')).toBeVisible();
  });

  test('Recovery start with invalid code returns generic error (no info leak)', async ({ request }) => {
    const res = await request.post(`${PORTAL}/api/recovery/start`, {
      data: { realm: 'passkey-prototyp', penr: 'invalid', code: '1234567890' },
    });
    expect([400, 429]).toContain(res.status());
    const json = await res.json().catch(() => ({}));
    // Must not leak existence
    expect(json.message).toBeTruthy();
    expect(json.message.toLowerCase()).not.toContain('nicht gefunden');
    expect(json.message.toLowerCase()).not.toContain('existiert');
  });

  test('Recovery with unsupported realm is rejected', async ({ request }) => {
    const res = await request.post(`${PORTAL}/api/recovery/start`, {
      data: { realm: 'unknown-realm', penr: 'x', code: '1234567890' },
    });
    expect([400, 429]).toContain(res.status());
  });

  test('Admin can issue recovery code and recovery flow works end-to-end', async ({ request }) => {
    // Issue recovery code for erika
    const issue = await request.post(`${PORTAL}/api/admin/recovery/issue`, {
      headers: { Authorization: `Bearer ${ROPS_TOKEN}` },
      data: { verifiId: '4f7a2c91b6d34e8fa50c1d2e3b4a5c6d', realm: 'passkey-prototyp' },
    });
    expect(issue.ok()).toBeTruthy();
    const issued = await issue.json();
    expect(issued.code).toMatch(/^\d{8,12}$/);
    expect(issued.penr).toBeTruthy();

    // Start recovery
    const start = await request.post(`${PORTAL}/api/recovery/start`, {
      data: { realm: issued.realm, penr: issued.penr, code: issued.code },
    });
    expect(start.ok()).toBeTruthy();
    const started = await start.json();
    expect(started.ok).toBe(true);
    expect(started.redirect_url).toContain('/recovery/register.html');

    // Verify recovery session
    const cookies = start.headers()['set-cookie'];
    const sess = await request.get(`${PORTAL}/api/recovery/session`, {
      headers: cookies ? { Cookie: cookies } : {},
    });
    expect(sess.ok()).toBeTruthy();
  });

  test('Recovery code is single-use', async ({ request }) => {
    const issue = await request.post(`${PORTAL}/api/admin/recovery/issue`, {
      headers: { Authorization: `Bearer ${ROPS_TOKEN}` },
      data: { verifiId: '9c1e5f7a2b4d6e8f0a1b2c3d4e5f6a7b', realm: 'passkey-prototyp' },
    });
    const issued = await issue.json();
    
    const start1 = await request.post(`${PORTAL}/api/recovery/start`, {
      data: { realm: issued.realm, penr: issued.penr, code: issued.code },
    });
    expect(start1.ok()).toBeTruthy();
    
    // Second use should fail
    const start2 = await request.post(`${PORTAL}/api/recovery/start`, {
      data: { realm: issued.realm, penr: issued.penr, code: issued.code },
    });
    expect([400, 429]).toContain(start2.status());
  });
});
