# Engineering Intent Document — Verimi-Ablösung durch Keycloak-Passkey

Stand: 2026-10-05 · Quellen: `idea.md`, `users.md`, `constraints.md`, `requirements.md`, `risks.md`, `open-questions.md`
Status: **Entwurf zur Freigabe**

> **Hinweis zur Quellenlage:** `docs/business-need.md` existiert nicht. Der
> Business-Need wurde ersatzweise aus `idea.md` Z.2 und `requirements.md` Z.1
> abgeleitet: reine Provider-Abschaltung, **kein** Compliance- oder
> Rechtszwang. Falls ein separates Business-Need-Dokument existiert, ist diese
> Ableitung zu gegenprüfen.

---

## 1. Problem Statement

Der externe Identitätsanbieter **Verifi stellt seinen Dienst zum 31.12.2026
ein**. Das Kundenportal ist der einzige Konsument dieses Endpunkts und damit
vom Abschalttermin abhängig. Nach dem 01.01.2026 steht kein Verimi-Login mehr
zur Verfügung.

Der Handlungsdruck entsteht **ausschließlich aus dem Provider-Abschalttermin**,
nicht aus Compliance, Gesetz oder Risikopolitik. Ein Identitätsnachweis ist
gesetzlich nicht vorgeschrieben (C-05).

Der Kern des Problems ist nicht der technische Login, sondern die **Migration
von bis zu 120.000 Endnutzern mit geringer technischer Affinität, ohne
kontrollierte Geräteumgebung**, in ein Credential-Modell ohne
Alternative und ohne Recovery-Weg.

**Ergänzung (Passkey-Recovery):** Geht ein Passkey verloren, ist der User
derzeit blockiert. Eine Re-Authentifizierung über einen IdP ist für diesen
Anwendungsfall zunächst out of scope. Es wird ein **selbstbedienbarer**
Recovery-Weg benötigt, damit ein User einen neuen Passkey registrieren und
sich wieder anmelden kann.

---

## 2. Users

| Gruppe | Beschreibung | Volumen | Leben ab 2027-01-01 |
|---|---|---|---|
| **A — Migriert** | Hat bis 2026-12-31 einen Passkey registriert | max. 80.000 | Passkey-Login. **Selbstbedienbarer Recovery-Weg über PENR + Einmalcode verfügbar (siehe Abschnitt 3/4).** |
| **B — Nicht migriert, DE/EU-Reisepass** | Kein Passkey, Reisepass vorhanden | Teilmenge der ~40.000 | Gesperrt; manuelle Reaktivierung 2027 möglich |
| **C — Nicht migriert, Nicht-EU-Reisepass** | Kein Passkey, kein ID-Nachweis möglich | Rest der ~40.000 | **Dauerhaft gesperrt. Kein Weg zurück.** |
| **D — Support / Portal-Betrieb** | Interne Fachsupport für Passkey-Fehler | unbekannt | Fachverantwortung ungeplant (OQ-18), Betrieb bei diesem Projekt (N-08) |

**Eckdaten:** kein Firmen-Account · geringe technische Affinität · Geräte
unkontrolliert · **mobil ausgeschlossen** (C-04) · migrierte Identitätsfelder
**nur** Name, Vorname, E-Mail (C-07).

Nicht betroffen: externe Partner/Lieferanten, Service-Accounts, M2M.

---

## 3. Goals

| Nr. | Ziel | Priorität |
|---|---|---|
| G-1 | Der Portal-Login funktioniert ab 2027-01-01 ohne Verimi | muss |
| G-2 | Endnutzer können sich bis 2026-12-31 **selbst** einen Passkey registrieren | muss |
| G-3 | Portal-Funktionalität bleibt für migrierte User unverändert | muss |
| G-4 | Der manuelle Weg für Gruppe B existiert am Stichtag einsatzbereit | muss |
| G-5 | Kein Eingriff in Portal-Datenlogik, Entitlement-Logik oder Stammdaten | muss |
| G-6 | Betriebsfähigkeit (Installation, Updates, Backup, Monitoring, Restore) ist in diesem Projekt nachgewiesen | muss |
| G-7 | Endnutzer können einen verlorenen Passkey **selbstbedient** über PENR + Einmalcode wiederherstellen und einen neuen Passkey registrieren, um sich wieder anzumelden | muss |

**Explizit kein Ziel:** rechtliche Identitätsverifikation, Redundanz/HA
(siehe R-13), mobile Passkeys, IdP-Re-Authentifizierung (für diesen Fall out of scope), Recovery durch Support, Cross-Realm-Recovery, Recovery bei Verlust von PENR und/oder Einmalcode.

---

## 4. Core Capabilities

### Phase 1 — Migrationsphase (bis 2026-12-31, Verimi + Keycloak parallel)

| ID | Fähigkeit |
|---|---|
| C-1.1 | Portal-Login-Button führt weiterhin zu Verimi; Verimi bleibt voll funktionsfähig (**Fallback**). |
| C-1.2 | Nach erfolgreicher Verimi-Auth prüft das Portal anhand der Verifi-Kennung, ob in Keycloak bereits ein Passkey existiert. |
| C-1.3 | Kein Passkey → **freiwillige** Registrierungsfrage (ja/nein, kein Zwang). |
| C-1.4 | Bei "ja": Vorbelegung von Name, Vorname, E-Mail aus Verifi; Registrierung in Keycloak (kein Mock im Endprodukt). |
| C-1.5 | Passkey vorhanden → nach Verimi-Authentifizierung direkter Zugang zum geschützten Bereich (keine erneute Passkey-Abfrage). *(Änderung 2026-10-08.)* |
| C-1.6 | Informationskampagne Brief + E-Mail an alle Endnutzer (Verantwortung: Auftraggeber, A-02). |
| C-1.7 | Wöchentliches Reporting der Migrationsquote. |
| C-1.8 | Zusätzlicher Login-Einstieg „Passkey Login": direkte Passkey-Authentifizierung über Keycloak, auch vor dem Stichtag nutzbar; nur für Identitätssubjekte mit registriertem Passkey erfolgreich. *(Entscheidung Projektträger 2026-10-08.)* |

### Phase 2 — Passkey-Login (ab 2027-01-01)

| ID | Fähigkeit |
|---|---|
| C-2.1 | Login-Button führt zu Keycloak; Authentifizierung via Passkey (WebAuthn). |
| C-2.2 | Nach Erfolg Zugriff auf den geschützten Bereich; Tokenstruktur / Mapping des Bereichs ist definiert. |
| C-2.3 | **Sperrlogik:** nicht migrierte User werden am Stichtag korrekt gesperrt. |
| C-2.4 | **Manuelle Reaktivierung für Gruppe B:** Identitätsprüfung am Schalter (DE/EU-Reisepass), Reaktivierung des **bestehenden** Accounts, Passkey-Registrierung, anschließend Login. |
| C-2.5 | Passkey ist das einzige Credential. Kein alternatives Credential. |

### Querschnitt

| ID | Fähigkeit |
|---|---|
| C-3.1 | Keycloak on-premise mit WebAuthn/Passkey, Desktop-Browser Chrome/Edge/Safari/Firefox auf Windows und macOS. |
| C-3.2 | Identitätsdaten Name, Vorname, E-Mail; Keycloak ist nach 2027-01-01 **einziger** Speicherort. |
| C-3.3 | Backup und Restore der Identity-Daten — **einmal getestet und mit gemessener Wiederherstellungszeit nachgewiesen** vor Produktivgang. |
| C-3.4 | Betriebsübergabe: Runbook für Installation, Update, Backup, Monitoring, Restore. |
| C-3.5 | **Erreichbarkeitstest vor Abschaltung:** Stichprobe über registrierte User, Passkey-Login gegenprüfen, nicht funktionierende Fälle aktiv zurückrufen (einzige wirksame Gegenmaßnahme gegen R-06/R-12). |
| C-3.6 | DSGVO: Verwendungszweckbindung der Identity-Daten (N-10), Lösch-/Aufbewahrungskonzept. |

### Prototyp (bis 2026-10-19, 2 Wochen)

| ID | Fähigkeit |
|---|---|
| C-P.1 | Portal-Mock: Login-Button + geschützter Bereich, der den Namen anzeigt. |
| C-P.2 | Verimi-Mock: vorbefüllte User-DB (Username/Passwort), Weiterleitung auf konfigurierbare URL. |
| C-P.3 | Keycloak mit Passkey, on-premise, **nah am Endprodukt** (kein Mock). |
| C-P.4 | Test-User für Migrations- und Passkey-Login. |
| C-P.5 | Nachweis: **Verimi-Mock und echtes Verimi sind über denselben Keycloak-Login ersetzbar.** |
| C-P.6 | **Passkey-Recovery:** Option „Passkey verloren“ auf der Portal-Loginseite; Recovery über PENR + Einmalcode zur erneuten Passkey-Registrierung (realm-gebunden). Nur für 3 der 9 Portale/Reiche im Prototyp. |

---

## 5. Out of Scope

| Ausgeschlossen | Wer verantwortet |
|---|---|
| Adesso-Login (bleibt unverändert bestehen) | bestehender Betrieb, OQ-10 |
| Kommunikation an Endnutzer (Brief/E-Mail) | Auftraggeber, manuell |
| Neue Portal-Funktionalität, Entitlements, Portal-Datenmigration | niemand |
| Geräteverwaltung, MDM, kontrollierte Browser/Endgeräte | niemand |
| Fachlicher Endnutzer-Support (Support-Hotline, Passkey-Hilfe) | **niemand — OQ-18** |
| Mobile Passkey-Lösung | später |
| IdP-Re-Authentifizierung für den Recovery-Fall | out of scope (dieser Task) |
| Support-initiierte Recovery | out of scope |
| Cross-Realm-Recovery | out of scope |
| Recovery bei Verlust von PENR und/oder Einmalcode | out of scope |
| Ausstellen von Einmalcodes für bereits registrierte User (Backfill) | out of scope |
| Implementierung der REST-API zum Abruf des PENR | out of scope (angenommen verfügbar) |
| Recovery über Keycloak-Login-UI | out of scope (nur Portal-Loginseite) |
| Hochverfuegbarkeit / Redundanz | bewusst nicht (R-13) |
| Rechtliche Identitätsverifikation der User | nicht vorgeschrieben (C-05) |

---

## 6. Constraints

| ID | Constraint |
|---|---|
| **CN-1** | **2027-01-01 ist extern fix** — Verimi wird abgeschaltet. Nicht verhandelbar. |
| **2026-12-31** | Verimi bleibt bis dahin vollständig verfügbar → **Fallback jederzeit möglich**. Gerissenes internes Ziel 2026-10-31 erzeugt keinen Projektschaden. |
| **CN-2** | Innere Ziele: Prototyp 2026-10-19, fertig und getestet 2026-10-31. Verzug bis Dezember ist verkraftbar (R-09). |
| **CN-3** | Mobilgeräte **ausgeschlossen** (Entscheidung des Auftraggebers). Wer nur mobil nutzt, wird vollständig ausgeschlossen. |
| **CN-4** | Geräteumgebung nicht kontrolliert → Geräteverlust = endgültiger Verlust des Accounts für Gruppe A. |
| **CN-5** | Last: 500–1.000 Logins/Monat; ~80.000 Registrierungen über 3 Monate (~900/Tag), gleichmäßig verteilt (Annahme). **Verfügbarkeitsziel nicht definiert (OQ-06).** |
| **CN-6** | Hosting Endprodukt: on-premise angenommen (AS-07), **Plattform offen (OQ-04)**. |
| **CN-7** | **Betrieb liegt bei diesem Projekt** (N-08): Installation, Updates, Backup, Monitoring, Restore. |
| **CN-8** | Migrierte Felder: **nur** Name, Vorname, E-Mail. Keine Kundennummer, keine Ausweisdaten, keine Adesso-Verknüpfung. |
| **CN-9** | Keycloak ist nach 2027-01-01 **einziger** Speicherort der Identitätsdaten; Verifi-Daten danach nicht mehr verfügbar. |
| **CN-10** | Kein Identitätsnachweis gesetzlich vorgeschrieben. Der dauerhafte Ausschluss von Gruppe C ist eine **geschäftliche, nicht rechtliche** Entscheidung. |
| **CN-11** | Identität Provider = Keycloak, Credential = Passkey (WebAuthn), Desktop-Browser Windows/macOS. |
| **CN-12** | Kein kontrollierter Gerätepool. |

---

## 7. Risks

Einstufung: W = Wahrscheinlichkeit, A = Auswirkung (1–5).

| ID | Risiko | W/A | Bewertung + Maßnahme |
|---|---|---|---|
| **R-01** | **Dauerhafter Zugangsverlust für ca. 40.000 Nicht-Migrierende** | 4/5 | Vom Projektträger bewusst akzeptiert. Aber: bei 40.000 Verlorenen ist dies ein Geschäftsschaden. **Tragender Mindestmigrationswert + Maßnahmenplan fehlen.** |
| **R-04** | **Kein Recovery bei Geräteverlust ohne gültigen Einmalcode** (bis 80.000 User) | 4/4 | Selbstbedienbarer Recovery-Weg über PENR + Einmalcode (G-7) vorhanden, wenn Einmalcode bei erstmaliger Registrierung ausgegeben und sicher verwahrt wurde. Ohne PENR+Einmalcode endgültiger Zugangsverlust (FR-104). Ausgabepflicht bei Registrierung sicherstellen. |
| **R-08** | **Zu geringe Migrationsquote** | 3/4 | 120.000 User, geringe Affinität, kein Kontrollgerät. Gegenmaßnahme: Mindestwert, Wochenquote, Eskalationsschwelle. |
| **R-12** | **Supportbelastung durch unbenutzbare Passkeys** | 4/3 | Fällt erst **nach** dem 31.12. auf — dann ist Verifi weg und Gruppe A hat keinen Recovery. Einzige wirksame Maßnahme: Erreichbarkeitstest (C-3.5). Fachsupport ist niemandem zugewiesen (OQ-18). |
| **R-11** | **Keine stabile Verknüpfung Account ↔ Portal-Stammdaten** | 3/4 | Ohne Kundennummer ist die E-Mail das einzige Merkmal — und sie ist änderbar. Schleichender Datenfehler bei 120.000 Usern. Entscheidung OQ-17 erforderlich (Empfehlung: E-Mail nur mit erneuter Verifi-Bestätigung oder gar nicht änderbar). |
| **R-05** | **Manueller Schalter existiert am Stichtag nicht** | 3/4 | "Ausreichend informiert per Brief/E-Mail" ist **kein** Prozess. Wer informiert 40.000 User, erfasst Rückmeldungen, betreibt den Schalter? Verantwortlichen **vor** Kampagnenstart benennen. Zusätzlich fehlt die authentifizierte Session für die Passkey-Registrierung (OQ-03). |
| **R-07 / R-13** | **Betrieb ohne definiertes Ziel** | 3/4 · 3/3 | On-Premise-Keycloak ohne Verfügbarkeitsziel und ohne Plattform. Bei übernommenem Betrieb bleibt die Priorisierung unbestimmt. Ausfall = Login-Ausfall für alle 120.000. Gegenmaßnahme: AK-11 (Restore-Nachweis), OQ-04/OQ-06 bis 2026-11-15 klären. |
| **R-06** | **Nicht kontrollierte Geräteumgebung** | 3/3 | Teil der Gruppe A wird sich trotz Registrierungsversuch **nicht anmelden können** — ein Fehler, den man erst nach der Sperrung bemerkt. |
| **R-10** | **Unbekannte Ausdehnung Gruppe B** (OQ-02) | 3/3 | Kapazitätsplanung des Schalters beruht auf einer unbekannten Zahl. |
| **R-02** | **Pauschalaler Ausschluss nach Nationalität** | 2/4 | Kein gesetzlicher Zwang → Ungleichbehandlung nicht rechtlich gedeckt. Verbraucherschutzfragen ungeprüft. Kurze rechtliche Prüfung empfohlen. |
| **R-03** | Account-Takeover über Identitätsverknüpfung | 1/5 | **Entschärft** — Verifi liefert eindeutige, nicht erratbare ID. Verbleib → R-04. |
| **R-09** | Zeitplan unrealistisch | 2/3 | Phasen als "sperrreif" kennzeichnen, damit ein Umlagern in den Dezember ohne Neustart möglich ist. |

---

## 8. Success Criteria

### Prototyp — bis 2026-10-19

| Nr. | Kriterium | Nachweis |
|---|---|---|
| SC-P1 | Ein Test-User durchläuft Migration und kann sich danach mit Passkey anmelden. | Testprotokoll |
| SC-P2 | Ein Test-User lehnt die Registrierung ab und erreicht trotzdem den geschützten Bereich. | Testprotokoll |
| SC-P3 | Ein Test-User registriert sich zweimal; der zweite Login über Verimi führt direkt in den geschützten Bereich (keine erneute Passkey-Abfrage). Die Anmeldung mit dem registrierten Passkey wird über den Einstieg „Passkey Login“ bzw. in Phase 2 nachgewiesen. *(Änderung 2026-10-08.)* | Testprotokoll |
| SC-P4 | Identitätsdaten werden aus dem Verimi-Mock vorbefüllt übernommen. | Testprotokoll |
| SC-P5 | Passkey funktioniert auf Desktop-Browsern. Mobil ist **nicht** getestet (dokumentierte Lücke). | Testprotokoll |
| SC-P6 | Erreichbarkeitstest-Methode ist umgesetzt und auf der Test-Population anwendbar. | Testprotokoll |

### Endprodukt — Produktivgang 2027-01-01

| Nr. | Kriterium | Nachweis |
|---|---|---|
| SC-1 | Am 2027-01-01 ist **kein** Login mehr über Verimi erforderlich. | Produktivtest |
| SC-2 | Der geschützte Bereich wird nur mit gültigem Keycloak-Token betreten. | Code-Review + Test |
| SC-3 | Ein nicht migrierter User wird am 2027-01-01 korrekt gesperrt. | Produktivtest |
| SC-4 | Für Gruppe B existiert ein **dokumentierter, einsatzbereiter** Reaktivierungsprozess inkl. benanntem Personal. | Prozessdokument |
| SC-5 | Backup und Restore der Identity-Daten wurden erfolgreich getestet; **Wiederherstellungszeit gemessen**. | Restore-Protokoll |
| SC-6 | Alle drei migrierten Felder (Name, Vorname, E-Mail) werden korrekt und ohne Nacharbeit übernommen. | Datenabgleich Stichprobe |
| SC-7 | Keycloak ist der einzige Speicherort; kein Verifi-Abruf im Regelbetrieb. | Code-Review + Netzwerkanalyse |
| SC-8 | **Migrationsquote ≥ Mindestwert** (zu setzen, siehe Blocker) und wöchentlich berichtet. | Report |
| SC-9 | **Erreichbarkeitstest abgeschlossen:** alle registrierten User haben einen funktionierenden Passkey-Login nachgewiesen; Fehlfälle wurden aktiv zurückgerufen. | Testprotokoll |
| SC-10 | Betriebs-Runbook (Installation, Update, Backup, Monitoring, Restore) liegt vor und ist geübt. | Runbook |

### Blocker für die Abnahme

| ID | Blocker | Owner | Benötigt bis |
|---|---|---|---|
| **OQ-11** | **Mindestmigrationswert.** Gefordert sind 100 % — erreichbar sind maximal 67 % (80.000 von 120.000). Ohne Zielwert gibt es keine Definition of Done. **Empfehlung: ≥ 95 % von 80.000 festlegen + Maßnahmenplan bei Unterschreitung.** | Auftraggeber | **2026-10-31** |
| **OQ-17** | **Änderbarkeit von Name/Vorname/E-Mail nach Registrierung.** Bestimmt das Identitätsdatenmodell und R-11. | Auftraggeber | vor Prototypabschluss |
| **OQ-03** | **Authentifizierte Session für die manuelle Reaktivierung (F-12).** Ohne sie ist Gruppe B nicht zurückzuholen. | Auftraggeber | 2026-12-15 |
| **OQ-04 / OQ-06** | **Hosting-Plattform und Verfügbarkeitsziel.** Bestimmt Betrieb und Reihenfolge der Betriebsmaßnahmen (SC-5). | Auftraggeber | 2026-11-15 |
| **OQ-18** | **Fachliche Supportverantwortung.** Trifft alle 120.000, derzeit niemandem zugewiesen. | Auftraggeber | 2026-11-30 |
| **A-03** | **Person, Ort, Schichten für den manuellen Schalter.** Ohne das ist SC-4 nicht erfüllbar. | Auftraggeber | 2026-11-30 |
| **OQ-15** | Verbindliche Zusage der Verkäuferin zum Abschalttermin. Die gesamte Planung hängt an einem externen Termin. | Auftraggeber | sofort |

### Bewusst nicht gemessen

Hochverfügbarkeit und Redundanz sind **kein** Erfolgskriterium. Bei 500–1.000
Logins/Monat und on-premise-Betrieb genügt bewusst eine einfache Konfiguration,
sofern SC-5 (gemessener Restore) erfüllt ist. Diese Entscheidung wird hier
explizit festgehalten, damit HA nicht später als ungeplanter Umfang auftaucht.