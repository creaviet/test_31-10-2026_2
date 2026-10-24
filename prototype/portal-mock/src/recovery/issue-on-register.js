/**
 * Hilfsfunktion zum Ausstellen eines Recovery-Codes bei erstmaliger
 * Passkey-Registrierung (BR-16).
 */
import { issueRecoveryCode } from './store.js';

export function issueCodeOnFirstRegistration({ realm, verifiId }) {
  const penr = verifiId; // Im Prototyp: PENR = verifi_id (für Testzwecke)
  return issueRecoveryCode({ realm, penr, verifiId });
}
