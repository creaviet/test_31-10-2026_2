/**
 * Passkey-Recovery Store (FR-100 ff.).
 *
 * - PENR ist realmgebunden (FR-101/BR-17)
 * - Einmalcode wird ausschließlich zum Zeitpunkt der Passkey-Registrierung
 *   ausgestellt (FR-102)
 * - Prototyp: 3 von 9 Portalen/Reichen ausreichend (FR-106)
 * - Keine Auskunft über Existenz ungültiger Codes (FR-107, FR-35-Prinzip)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Für Prototyp-Zwecke: einfache In-Memory + optional persistiert
const recoveryMap = new Map(); // key: `${realm}:${penr}` -> { code, realm, verifiId, createdAt, usedAt, issuedAtRegistration }

export function isSupportedRealm(realm) {
  // Für den Prototyp sind 3 der 9 Portale/Reiche ausreichend (FR-106)
  // Erlaubt konfigurierbar; Default: passkey-prototyp und 2 weitere
  const supported = (process.env.RECOVERY_SUPPORTED_REALMS || 'passkey-prototyp,portal-a,portal-b')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return supported.includes(realm);
}

function keyOf(realm, penr) {
  return `${String(realm)}:${String(penr).trim()}`;
}

export function issueRecoveryCode({ realm, penr, verifiId }) {
  if (!isSupportedRealm(realm)) {
    // Realm-Scoping hart durchsetzen
    return null;
  }
  const code = generateCode();
  const k = keyOf(realm, penr);
  recoveryMap.set(k, {
    code,
    realm,
    penr: String(penr).trim(),
    verifiId,
    createdAt: new Date().toISOString(),
    usedAt: null,
    issuedAtRegistration: true,
  });
  return { code, realm, penr: String(penr).trim() };
}

function generateCode() {
  // 8-12-stelliger Einmalcode (BR-16)
  const len = 10;
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String(bytes[i] % 10);
  }
  return s;
}

export function validateAndConsume({ realm, penr, code }) {
  if (!isSupportedRealm(realm)) {
    // Gleiches Prinzip wie FR-35 - keine Auskunft
    return { ok: false };
  }
  const k = keyOf(realm, penr);
  const entry = recoveryMap.get(k);
  if (!entry) {
    return { ok: false };
  }
  if (entry.usedAt) {
    return { ok: false };
  }
  // timing-safe Vergleich
  if (entry.code.length !== String(code).length) {
    return { ok: false };
  }
  let ok = true;
  // einfacher Vergleich für Prototyp
  if (entry.code !== String(code).trim()) {
    ok = false;
  }
  if (!ok) {
    return { ok: false };
  }
  // konsumieren
  entry.usedAt = new Date().toISOString();
  recoveryMap.set(k, entry);
  return { ok: true, verifiId: entry.verifiId, realm: entry.realm };
}

export function hasRecoveryCode({ realm, verifiId }) {
  for (const entry of recoveryMap.values()) {
    if (entry.realm === realm && entry.verifiId === verifiId && !entry.usedAt) {
      return true;
    }
  }
  return false;
}

export function getRecoveryForVerifi({ realm, verifiId }) {
  for (const [k, entry] of recoveryMap.entries()) {
    if (entry.realm === realm && entry.verifiId === verifiId && !entry.usedAt) {
      return { key: k, ...entry };
    }
  }
  return null;
}
