/**
 * Playwright-Konfiguration für die E2E-Abnahmetests (Prototyp).
 *
 * Nutzt den installierten System-Chrome ("channel: chrome") statt eines
 * heruntergeladenen Chromium — erfüllt denselben Zweck (CDP-WebAuthn).
 * workers: 1 + serial, weil die Tests eine gemeinsame Browser-Context-
 * Geschichte brauchen (registrierter Passkey → Folge-Logins).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.js', '**/*.test.mjs'],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
  },
});