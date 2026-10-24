# Software Requirements Specification — Verimi-Ablösung durch Keycloak-Passkey

Stand: 2026-10-05 · Quelle: `intent.md` · Änderung 2026-10-06
Status: **Entwurf zur Freigabe**

> **Änderung 2026-10-06:** Migrationsquoten-Reporting ist bis zum
> 2026-10-31 **out-of-scope** und auf **`kann`** herabgestuft:
> FR-80..FR-83, AC-11, AC-12, BR-01, OQ-11. Kein Wochentreporting, kein
> Eskalationsprozess. Siehe Abschnitt 7.

> **Änderung 2026-10-08 (Entscheidung Projektträger am Prototyp):**
> 1. In der Migrationsphase entfällt die erneute Passkey-Abfrage nach
>    erfolgreicher Verimi-Authentifizierung (FR-16, AC-P3, C-1.5): Verimi ist
>    bis zum Stichtag der einzige Authentisierungsfaktor der Phase 1. Der
>    bisherige Verify-Pfad wurde entfernt.
> 2. Zusätzlich existiert ein zweiter, ausdrücklich dokumentierter
>    Login-Einstieg **„Passkey Login"** (FR-01), der auch vor dem Stichtag
>    direkt zur Passkey-Authentifizierung führt.
> Rückfallregelungen (FR-02, AK-10) und die Phasenlogik (Phase 2) bleiben
> unberührt.

> **Keine Implementierungsentscheidungen.** Dieses Dokument beschreibt *was* das
> System tun muss, nicht *womit*. Produkt-, Protokoll- und Technologie-Wahlen sind
> bewusst nicht getroffen. Wo Zahlenwerte nötig waren, sind sie als
> **Vorschlag (V)** markiert und bestätigungspflichtig.
>
> **Verbindlichkeitsstufen:** `muss` = Abnahmekriterium · `soll` = wichtig, kein
> Abnahmekriterium · `kann` = optional.

---

## 0. Traceability- und Lesehinweise

| Quelle | Beziehung |
|---|---|
| `intent.md` C-x / G-x / SC-x | Fähigkeiten, Ziele, Erfolgskriterien → hier zu FR/NFR/AC verfeinert |
| `pre-requirements.md` F-x / N-x / P-x | Vorangegangene Anforderungsrunde → hier konsolidiert |
| `open-questions.md` OQ-x | Offene Punkte, die **Voraussetzung** für die jeweilige Anforderung sind |

**Kennzeichnung:** `[OQ-xx]` = Anforderung ist bis zur Klärung nicht
freigabereif. `[V]` = Wert ist ein Vorschlag, kein bestätigter Zielwert.

---

## 1. Functional Requirements

### 1.1 Login-Einstieg und Weiterleitung

| Nr. | Anforderung | Phase | Trace |
|---|---|---|---|
| **FR-01** | Das Portal stellt einen **phasengesteuerten** Login-Einstieg („Anmelden") für Endnutzer bereit: vor dem Stichtag führt er zum Verimi-Login, ab dem Stichtag zur Passkey-Authentifizierung. Zusätzlich existiert ein zweiter, ausdrücklich dokumentierter Einstieg **„Passkey Login"**, der auch vor dem Stichtag direkt zur Passkey-Authentifizierung führt und für Identitätssubjekte ohne registrierten Passkey nicht erfolgreich endet. Der Phasenzustand wird nicht im Portal-Code hartkodiert, sondern von außen steuerbar sein. *(Änderung 2026-10-08: Einstieg „Passkey Login" ergänzt.)* | beide | C-1.1, C-1.8, C-2.1 |
| **FR-02** | Vor dem Stichtag ist der Login-Einstieg jederzeit **ohne Datenverlust und ohne Codeänderung** auf den Verimi-Weg zurückstellbar (Fallback). | Phase 1 | C-1.1, CN-1 |
| **FR-03** | Alle Login-Einstiege („Anmelden", „Passkey Login") leiten ausschließlich auf die dokumentierten Ziele weiter (Phasenziel bzw. Passkey-Authentifizierung). Es existiert kein weiterer, undokumentierter Login-Weg für Endnutzer. *(Änderung 2026-10-08: „Passkey Login" ist dokumentiert, siehe FR-01.)* | beide | C-2.5 |
| **FR-04** | Der Adesso-Login bleibt unverändert bestehen und wird von dieser Lösung weder angefasst noch in den Phasenwechsel einbezogen. `[OQ-10]` | beide | Out of Scope |
| **FR-05** | Auf der **Portal-Loginseite** wird ein zusätzlicher Eintrag **„Passkey verloren“** bereitgestellt. Dieser führt zu einem selbstbedienbaren Recovery-Dialog. Eine Änderung der Keycloak-Login-UI ist **nicht** gefordert. | beide | G-7, C-P.6 |

### 1.2 Migrationsphase — Registrierung

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-10** | Nach erfolgreicher Authentifizierung über Verifi prüft das Portal anhand der eindeutigen, nicht erratbaren Verifi-Kennung, ob für dieses Identitätssubjekt bereits ein Passkey registriert ist. | C-1.2, R-03 |
| **FR-11** | Existiert **kein** Passkey, wird dem User eine Registrierungsfrage mit zwei Antwortmöglichkeiten (ja/nein) gestellt. | C-1.3 |
| **FR-12** | Die Registrierung ist **freiwillig**. Ein "Nein" führt ohne Nachteil, ohne Fehlermeldung und ohne Sperrhinweis in den geschützten Bereich. | C-1.3, BR-05 |
| **FR-13** | Bei "Ja" übernimmt das Portal die Identitätsdaten aus Verifi **vorbefüllt** in das Registrierungsformular: Nachname, Vorname, E-Mail-Adresse. Der User muss diese Felder nicht abtippen. | C-1.4, CN-8 |
| **FR-14** | Es werden **ausschließlich** diese drei Felder übernommen. Kundennummer, Ausweisdaten, Adesso-Verknüpfung und Verifi-interne Metadaten werden nicht übernommen und nicht gespeichert. | C-1.4, CN-8 |
| **FR-15** | Die Registrierung eines Passkeys ist technisch **nur** möglich, wenn eine gültige, dem User zuordenbare authentifizierte Session vorliegt. Es existiert kein Weg, einen Passkey für ein fremdes Identitätssubjekt zu registrieren. | C-1.4, R-03 |
| **FR-16** | Existiert **bereits** ein Passkey, wird der User nach erfolgreicher Verimi-Authentifizierung unmittelbar in den geschützten Bereich geleitet — **keine** erneute Passkey-Abfrage. *(Änderung 2026-10-08: frühere Vorgabe „Passkey-Abfrage nach Verimi-Login" ersetzt; Verimi ist bis zum Stichtag der einzige Authentisierungsfaktor der Migrationsphase.)* Die Passkey-Authentifizierung ist vor dem Stichtag über den Einstieg „Passkey Login" (FR-01), ab dem Stichtag über FR-30 möglich. | C-1.5, C-1.8 |
| **FR-17** | Nach erfolgreicher Registrierung ist der User in derselben Sitzung in der Lage, sich mit dem neuen Passkey anzumelden. | C-1.4 |
| **FR-18** | Jede Registrierung erzeugt einen datensystemseitig auswertbaren Eintrag mit Zeitpunkt und Ergebnis, der Grundlage für das Wochenreporting ist. | C-1.7 |
| **FR-19** | Registrierungen werden mit Zeitstempel und Ergebnis protokolliert; die Protokolle dienen der Nachweisführung gegenüber dem Auftraggeber und der Fehleranalyse des Erreichbarkeitstests. | C-1.7, C-3.5 |

### 1.3 Passkey-Login (Einstieg „Passkey Login" sowie ab Stichtag)

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-30** | Der Login-Einstieg führt zur Passkey-Authentifizierung des Identitätsanbieters. *(Änderung 2026-10-08: gilt auch für den Einstieg „Passkey Login" vor dem Stichtag, FR-01.)* | C-2.1 |
| **FR-31** | Nach erfolgreicher Authentifizierung erhält der User Zugriff auf den geschützten Portalbereich. | C-2.2, G-3 |
| **FR-32** | Der geschützte Bereich ist **ausschließlich** mit einem gültigen, nicht abgelaufenen Token des neuen Identitätsanbieters betretbar. Ein veralteter, selbst erzeugter oder vom Client manipulierter Berechtigungsnachweis wird abgewiesen. | C-2.2, G-1 |
| **FR-33** | Es ist genau **ein** Credential für Endnutzer vorgesehen. Ein alternatives Credential wird technisch nicht angeboten. | C-2.5, BR-03 |
| **FR-34** | Im Rahmen des **selbstbedienbaren Recovery-Wegs** (FR-100 ff.) kann ein User nach erfolgreicher Validierung von PENR + Einmalcode einen neuen Passkey registrieren. Ein E-Mail-Link, SMS-Code oder sonstiger nicht definierter Wiederherstellungsweg wird nicht eingesetzt. Der bestehende Vermerk gilt für Fälle **ohne** gültigen Einmalcode. | C-2.5, BR-04, G-7 |
| **FR-35** | Fehlgeschlagene Passkey-Authentifizierungen erzeugen eine für Endnutzer verständliche Meldung und einen technisch auswertbaren Log-Eintrag. Die Meldung enthält **keine** Information darüber, ob das Identitätssubjekt existiert. | C-2.1, NFR-Sec-06 |

### 1.4 Sperr- und Übergangslogik

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-40** | Zum Stichtag werden alle Endnutzer ohne registrierten Passkey vom Zugang zum geschützten Bereich ausgeschlossen. | C-2.3, SC-3 |
| **FR-41** | Die Sperre wirkt **nicht** auf den Adesso-Login und nicht auf den manuellen Schalterprozess. | C-2.3, FR-04 |
| **FR-42** | Das Umschalten auf die Passkey-Phase erfolgt zu einem **konfigurierbaren** Zeitpunkt, ohne Neustart und ohne Datenmigration, damit ein Vorziehen oder Verschieben des Stichtags ohne Bauen neuer Software möglich ist. | CN-1, R-09 |
| **FR-43** | Bestehende Sitzungen zum Stichtag: Es muss entscheidbar sein, ob bestehende Sitzungen fortbestehen oder eine erneute Anmeldung erforderlich ist. `[OQ-13]` | OQ-13 |
| **FR-44** | Die Sperrentscheidung ist **protokolliert und nachvollziehbar**: für ein gesperrtes Identitätssubjekt ist eindeutig dokumentierbar, dass die Sperrung mangels Passkey und nicht aus einem anderen Grund erfolgte. | C-2.3, SC-3 |
| **FR-45** | Vor dem Stichtag sind die Meldungen der gesperrten Identitätssubjekte so formuliert, dass sie zum manuellen Weg für berechtigte Personen führen, **ohne** die Gruppe ohne Nachweismöglichkeit aktiv abzuweisen. `[BR-06]` | BR-06, C-2.4 |

### 1.5 Manuelle Reaktivierung (Gruppe B)

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-50** | Für Endnutzer mit deutschem oder EU-Reisepass existiert ein manueller Prozess zur Nachregistrierung im Jahr 2027. | C-2.4, F-12 |
| **FR-51** | Der Prozess **reaktiviert den bestehenden** Datensatz. Es wird **kein** neuer Account angelegt. Die Identität wird anhand des Reisepasses gegen den bestehenden Datensatz geprüft. | C-2.4, BR-07 |
| **FR-52** | Nach erfolgreicher Prüfung wird für den bestehenden Datensatz ein Passkey registriert; danach ist die Anmeldung mit Passkey möglich. | C-2.4 |
| **FR-53** | Der Prozess ist **dokumentiert, einsatzbereit und mit benanntem Personal, Ort und Erreichbarkeitszeiten** hinterlegt, bevor die Informationskampagne startet. `[A-03]` `[OQ-18]` | SC-4, R-05 |
| **FR-54** | Der Prozess ist zeitlich befristet und das Enddatum ist festgelegt. `[OQ-14]` | OQ-14 |
| **FR-55** | Wie eine für die Registrierung erforderliche authentifizierte Session erzeugt wird, ist **festgelegt** — am Schalterterminal, per Einmalcode oder durch Vertrauen in die Reisepassprüfung. Ohne diese Festlegung ist FR-52 nicht umsetzbar. `[OQ-03]` | OQ-03 |
| **FR-56** | Der manuelle Prozess führt **zu keinem** Ergebnis für Endnutzer, für die kein Reisepassnachweis möglich ist. Es existiert kein Ausweichweg, der diese Einschränkung umgeht. | BR-06, CN-10 |

### 1.6 Identitätsdaten

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-60** | Der Datenbestand umfasst nach Abschluss der Migration **genau** drei Identitätsfelder: Nachname, Vorname, E-Mail-Adresse. | CN-8, SC-6 |
| **FR-61** | Es existiert **keine** vom Endnutzer nicht veränderbare Kennung, die den Zugangsdaten eindeutig den Portal-Stammdaten zuordnet. Diese Einschränkung ist bekannt und akzeptiert. `[BR-08]` | R-11, FR-14 |
| **FR-62** | Ob und wie Endnutzer die drei Felder nach der Registrierung ändern dürfen, ist **festgelegt**. Solange dies offen ist, gelten die konservativen Voreinstellungen in BR-08. `[OQ-17]` | OQ-17, R-11 |
| **FR-63** | Ab dem Stichtag ist das Identitätsdatensystem der **einzige** Speicherort dieser Identitätsdaten. Im Regelbetrieb erfolgt kein Abruf beim ehemaligen Anbieter. | CN-9, SC-7 |
| **FR-64** | Der Abruf der Identitätsdaten aus Verifi endet mit Abschluss der Migration. Ein Verbleib technischer Kopien, Caches oder Sicherungen mit Identitätsbezug ist im Betriebs-Runbook geregelt. `[OQ-09]` | C-3.6, OQ-09 |
| **FR-65** | Identitätsdaten werden ausschließlich zum Zweck der Authentifizierung verwendet. Eine über diesen Zweck hinausgehende Verwendung ist technisch nicht vorgesehen. | C-3.6, NFR-DS-01 |

### 1.7 Erreichbarkeitstest

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-70** | Vor dem Stichtag wird für **alle** registrierten Passkeys ein Stichprobentest durchgeführt, ob eine Anmeldung mit diesem Passkey tatsächlich möglich ist. | C-3.5, R-06, R-12 |
| **FR-71** | Das Verfahren ist so gestaltet, dass es **ohne** Mitwirkung des Endnutzers auskommt und ohne Kenntnis des Passkey-Geheimnisses auskommt. `[V: Prüfung über serverseitig registrierte Credential-IDs und Erreichbarkeit der Authentifizierung; das konkrete Verfahren ist bei der Ausarbeitung zu bestätigen]` | C-3.5 |
| **FR-72** | Endnutzer, deren Passkey-Anmeldung nicht nachweisbar funktioniert, werden **aktiv** zurückgerufen und auf eine rechtzeitige Migration oder den manuellen Weg verwiesen. Der selbstbedienbare Recovery-Weg (FR-100 ff.) stellt hierfür keine generelle Ersetzung des Erreichbarkeitstests dar. | C-3.5, OQ-16, G-7 |
| **FR-73** | Ergebnis und Quote des Erreichbarkeitstests werden dokumentiert und berichtet. `[V: Vollständigkeitsnachweis über alle registrierten Passkeys, nicht nur über eine Stichprobe]` | SC-9 |
| **FR-74** | Der Erreichbarkeitstest endet rechtzeitig **vor** dem Stichtag, mit einer Vorlaufzeit, die eine erneute Migration für die zurückgerufenen Endnutzer noch zulässt. `[V: Abschluss bis 2026-11-30]` | R-06, OQ-16 |

### 1.8 Passkey-Recovery (selbstbedient)

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-100** | Der Dialog **„Passkey verloren“** auf der Portal-Loginseite erfasst **PENR** und den **8-12-stelligen Einmalcode**. Nur diese beiden Werte sind für den Start der Recovery erforderlich. | G-7, C-P.6 |
| **FR-101** | Der **PENR** ist einem bestimmten Portal/Realm zugeordnet. Die Validierung ist **realmgebunden**. Eine PENR ist nur im zugehörigen Realm gültig; Cross-Realm-Recovery ist nicht zulässig. Die Keycloak-Instanz ist entsprechend anzupassen. | G-7, CO-09-ähnlich / Realm-Scoping-Hardconstraint |
| **FR-102** | Der **Einmalcode** wird **ausschließlich zum Zeitpunkt der Passkey-Registrierung** ausgestellt. Codes für User, die bereits vor dieser Funktion einen Passkey registriert haben, werden nicht nachgestellt (Backfill) — out of scope. | G-7 |
| **FR-103** | Nach erfolgreicher Prüfung von PENR + Einmalcode kann der User **genau wie bei der erstmaligen Passkey-Registrierung** einen neuen Passkey in Keycloak registrieren. Nach erfolgreicher Registrierung ist eine erneute Anmeldung mit dem neuen Passkey möglich. | G-7, FR-17 |
| **FR-104** | Das PENR kann nach Annahme als bekannt vorausgesetzt werden (auf E-Mails vorhanden, vergleichbar einer Versicherungsnummer). Ein Verlust des PENR ist out of scope. Verlust **beider** Werte (PENR + Einmalcode) ist out of scope. | G-7 |
| **FR-105** | Die Wiederherstellung ist **nur selbstbedient**. Support-initiierte Recovery ist nicht gefordert. Der Abruf des PENR erfolgt über eine vorhandene REST-API (Implementierung out of scope) — die Lösung darf davon ausgehen, dass diese verfügbar ist. | G-7 |
| **FR-106** | Für den Prototyp sind **3 der 9 Portale/Reiche** ausreichend. Realm-Scoping ist für alle abgedeckten Reiche hart durchzusetzen. | G-7, C-P.6 |
| **FR-107** | Recovery-Vorgänge sind protokolliert (Zeitpunkt, Realm/Portal, Ergebnis), enthalten aber **keine** Passkey-Geheimnisse und geben **keine** Auskunft darüber, ob ein PENR/Einmalcode existiert oder ungültig ist (gleiches Prinzip wie FR-35/NFR-Sec-04). | G-7, NFR-Sec-04, NFR-Sec-06 |

### 1.9 Migrationsquoten-Reporting — `kann`, out-of-scope bis 2026-10-31

> **Herabstufung 2026-10-06:** Bis zum 2026-10-31 wird dieses Feature nicht
> umgesetzt und nicht abgenommen. Alle Anforderungen dieser Abteilung sind
> `kann` — sie dürfen implementiert werden, begründen aber keinen
> Abnahmeentscheid.

| Nr. | Stufe | Anforderung | Trace |
|---|---|---|---|
| **FR-80** | `kann` | Die Migrationsquote wird maschinell ermittelt und **wöchentlich** berichtet. | C-1.7, SC-8 |
| **FR-81** | `kann` | Der Report weist getrennt aus: registrierte Passkeys gesamt, davon aus der registrierungsfähigen Grundgesamtheit, geschätzter Anteil nicht abgeschlossener Migrationen, sowie Anzahl aktiv zurückgerufener Endnutzer. | R-01, R-08 |
| **FR-82** | `kann` | Die Erhebung enthält **keine** Personendaten; sie arbeitet ausschließlich mit aggregierten Zählwerten. | NFR-DS-01 |
| **FR-83** | `kann` | Unterschreitet die Quote einen festgelegten Mindestwert, wird ein **Eskalationsprozess** ausgelöst. Der Mindestwert und die Schwelle sind festzulegen. `[OQ-11]` | BR-01, OQ-11 |

### 1.10 Betrieb

| Nr. | Anforderung | Trace |
|---|---|---|
| **FR-90** | Für das Identitätsdatensystem liegen vollständige, geübte Anleitungen vor für: Installation, Konfiguration, Update, Backup, Monitoring, Wiederherstellung und Notbetrieb. | C-3.4, G-6, SC-10 |
| **FR-91** | Backup und Wiederherstellung der Identity-Daten sind vor Produktivgang **einmal vollständig durchgespielt**, und die **gemessene Wiederherstellungszeit** ist dokumentiert. | C-3.3, SC-5 |
| **FR-92** | Die Wiederherstellung umfasst einen geprüften Wiederanlauf bis zur Funktionsfähigkeit des Anmeldevorgangs, nicht nur die Rückspielung eines Datenbestandes. | C-3.3, SC-5 |
| **FR-93** | Der Betrieb erfolgt durch dieses Projekt. Verantwortliche Personen sind namentlich benannt und vertretbar. `[OQ-05, N-08]` | CN-7 |
| **FR-94** | Ein Monitoring meldet Nichterreichen der Anmeldung, Fehlerhäufungen bei der Registrierung und Ausfälle des Identitätsdatensystems. | C-3.4 |
| **FR-95** | Der Notbetrieb ist dokumentiert: Wer entscheidet über einen Rückfall, wer informiert den Auftraggeber, und in welcher Reihenfolge wird gehandelt. `[V: Bezug auf die Irreversibilität des Stichtags — nach dem 01.01.2027 existiert kein Rückfallweg]` | CN-1, SC-10 |

---

## 2. Non-Functional Requirements

### 2.1 Sicherheit

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-Sec-01** | Ein vorabregistrierter Passkey durch eine dritte Person ist technisch ausgeschlossen. Die Zuordnung stützt sich auf eine eindeutige, nicht erratbare Identität und auf eine gültige authentifizierte Session. | — | R-03, FR-15 |
| **NFR-Sec-02** | Passkey-Geheimnisse verlassen das Gerät des Endnutzers zu keinem Zeitpunkt. Es existiert keine Export-, Kopier- oder Wiederherstellungsfunktion für Passkey-Geheimnisse. | — | FR-34 |
| **NFR-Sec-03** | Der gesamte Authentifizierungs- und Registrierungsverkehr ist verschlüsselt. | — | G-1 |
| **NFR-Sec-04** | **Keine** Fehlermeldung und **kein** Antwortzeit-Unterschied geben preis, ob ein Identitätssubjekt existiert oder ob ein Passkey hinterlegt ist. | — | FR-11, FR-35, NFR-Sec-06 |
| **NFR-Sec-05** | Authentifizierungs- und Registrierungsversuche sind gegenautomatisierte Missbrauchsversuche geschützt. `[V: Rate-Limiting je Identität und je Quelle]` | — | R-03 |
| **NFR-Sec-06** | Protokolle enthalten **keine** Passkey-Geheimnisse und **keine** im Klartext abrufbaren Identitätsfelder. | — | NFR-DS-02 |
| **NFR-Sec-07** | Zugriff auf Identitätsdaten, Protokolle und Betriebsfunktionen ist nach dem Prinzip der geringsten Rechte geregelt; siehe Abschnitt 4. | — | Abschnitt 4 |
| **NFR-Sec-08** | Sicherheitsrelevante Ereignisse (Registrierung, Anmeldung, Sperrung, Reaktivierung, Betriebshandlung) sind **nachvollziehbar protokolliert** und über einen zusammenhängenden Zeitraum aufbewahrbar. `[V: Aufbewahrung mindestens bis zum Abschluss der Nachweisführung 2027-Q2]` | — | FR-19, C-3.6 |
| **NFR-Sec-09** | Reaktivierungen am manuellen Schalter sind je Einzelfall **protokolliert** (wer, wann, welcher Datensatz, aufgrund welchen Reisepasses). | — | FR-51, C-3.6 |

### 2.2 Datenschutz und Datenhaltung

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-DS-01** | Personenbezogene Daten werden ausschließlich zum Zweck der Authentifizierung verarbeitet. Reporting und Statistik arbeiten aggregiert und ohne Personenbezug. | — | FR-82, C-3.6 |
| **NFR-DS-02** | Identitätsdaten und Passkey-Metadaten werden im Ruhezustand verschlüsselt gespeichert. | — | C-3.2 |
| **NFR-DS-03** | Für den neuen Speicherort der Identitätsdaten liegt eine geprüfte Auftragsverarbeitungsvereinbarung vor. `[OQ-08]` | vor Produktivgang | C-3.6 |
| **NFR-DS-04** | Aufbewahrungsfristen und ein Löschkonzept für Identitätsdaten nach dem Stichtag sind festgelegt. `[OQ-09]` | vor Stichtag | FR-64 |
| **NFR-DS-05** | Es werden keine Daten in Regionen verarbeitet, für die keine Rechtsgrundlage besteht. | — | C-3.6 |

### 2.3 Verfügbarkeit und Wiederherstellung

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-AV-01** | **Das Verfügbarkeitsziel ist nicht definiert und ist vor Produktivgang festzulegen.** `[OQ-06]` | **offen** | CN-5 |
| **NFR-AV-02** | Ausfall des Identitätsdatensystems bedeutet Ausfall des Portal-Logins für **alle** Endnutzer. Dieser Zusammenhang ist zu dokumentieren und in der Priorisierung des Betriebs zu berücksichtigen. | — | R-07, R-13 |
| **NFR-AV-03** | Es ist **eine** Instanz vorgesehen. Redundanz ist bewusst nicht Anforderung. `[V: bewusste Entscheidung, um Hochverfügbarkeit nicht als ungeplanten Umfang aufkommen zu lassen]` | — | Out of Scope, R-13 |
| **NFR-AV-04** | Das **Wiederherstellungsziel (RTO)** wird gemessen und als Zahl dokumentiert. `[V: Wiederherstellung bis Anmeldefähigkeit ≤ 4 h; Bestätigung erforderlich]` | offen | SC-5, FR-91 |
| **NFR-AV-05** | Bis zum Stichtag muss die Verfügbarkeit des Login-Wegs durchgehend gewährleistet sein; Verimi ist in dieser Zeit der Rückfallweg. | — | FR-02, CN-1 |
| **NFR-AV-06** | Der Stichtag ist ein **strikter Umstellungszeitpunkt mit Datenverlust-Risiko** (kein Rückfall). Er ist im Betriebs-Runbook als solcher gekennzeichnet und mit Freigabe- und Kommunikationsschritten hinterlegt. | — | CN-1, FR-95 |

### 2.4 Kapazität und Last

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-Perf-01** | Kapazität für **120.000** Identitätsdatensätze und **80.000** Passkeys. | — | CN-5 |
| **NFR-Perf-02** | Dauerlast: 500–1.000 Logins pro Monat. Spitzenlast Migration: ~900 Registrierungen pro Tag über 3 Monate, gleichmäßig verteilt. | — | CN-5 |
| **NFR-Perf-03** | Antwortzeit der Passkey-Anmeldung `[V: ≤ 3 s bis zur Anzeige der geschützten Seite, Bestätigung erforderlich]`. | offen | G-3 |
| **NFR-Perf-04** | Registrierung erzeugt für den Endnutzer spürbare Verzögerungen, die **unterhalb** der Abbruchschwelle liegen. `[V: ≤ 30 s, Bestätigung erforderlich]` | offen | G-2 |
| **NFR-Perf-05** | Der Identitätsprüfschritt nach Verimi-Anmeldung ist für den Endnutzer nicht als Wartezeit wahrnehmbar. `[V: ≤ 1 s zusätzlich, Bestätigung erforderlich]` | offen | FR-10 |

### 2.5 Kompatibilität und Umgebungen

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-Env-01** | Unterstützt werden aktuelle Versionen von Chrome, Edge, Safari und Firefox auf **Windows und macOS**. | — | C-3.1, CN-11 |
| **NFR-Env-02** | **Mobilgeräte sind ausgeschlossen.** Die Lösung ist auf Mobilgeräten weder erforderlich noch zuverlässig nutzbar; dies wird dem Endnutzer nicht als Fehler angezeigt, sondern durch die Ansprache der Mobilnutzer in der Kampagne berücksichtigt. `[OQ-12]` | — | CN-3, OQ-12 |
| **NFR-Env-03** | Endgeräte und Browser der Endnutzer stehen **nicht** unter Kontrolle des Projekts. Es wird keine Geräteverwaltung, kein MDM und keine kontrollierte Browser-Umgebung vorausgesetzt. | — | CN-12, Out of Scope |
| **NFR-Env-04** | Nicht unterstützte oder unsichere Browserkontexte führen zu einer **verständlichen, handlungsanweisenden** Meldung, nicht zu einem technischen Fehlertext. | — | R-06, R-12 |

### 2.6 Benutzerfreundlichkeit und Lokalisierung

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-UX-01** | Sprache der Nutzerinteraktion ist **Deutsch**. | — | C-3.1 |
| **NFR-UX-02** | Die Zielgruppe hat **geringe technische Affinität**. Registrierung und Anmeldung sind ohne Vorwissen, ohne Anleitung durch Dritte und ohne Eingabe von Zugangsdaten möglich. | — | §2 |
| **NFR-UX-03** | Der Umfang der für den Endnutzer sichtbaren Abläufe wird auf ein Minimum reduziert: der Login-Einstieg („Anmelden"; optional zweiter Einstieg „Passkey Login", FR-01), eine Registrierungsfrage, eine Bestätigung. *(Änderung 2026-10-08.)* | — | C-1.3 |
| **NFR-UX-04** | Die Registrierungsfrage wird **bei jedem Login bis zum 31.12.2026 erneut gestellt**, bis der Nutzer einen Passkey registriert. Ein "Nein" führt weiterhin ohne Fehlermeldung und ohne Sperrhinweis in den geschützten Bereich. Wer bis zum Stichtag nicht registriert, kann sich ab 01.01.2027 nicht mehr anmelden. *(Änderung 2026-10-06: Die frühere Vorgabe „nur einmal stellen" war falsch.)* | — | FR-11, FR-12, FR-40 |
| **NFR-UX-05** | Es werden keine Fachbegriffe aus dem Bereich WebAuthn, Schlüssel, Gerät oder Kryptografie gegenüber dem Endnutzer verwendet. | — | NFR-UX-02 |
| **NFR-UX-06** | Die Lösung ist barrierearm nach anerkannten Standards bedienbar. **`muss`** — Abnahmekriterium: WCAG 2.1 AA für die betroffenen Abläufe (Entscheidung 2026-10-06, Zielwert nicht mehr offen). | WCAG 2.1 AA | C-3.1, AC-17 |

### 2.7 Wartbarkeit und Betrieb

| Nr. | Anforderung | Zielwert | Trace |
|---|---|---|---|
| **NFR-Ops-01** | Stichtag und Phasenschalter sind **konfigurierbar**, nicht neu zu bauen. Ein Verschieben des Stichtags erfordert keinen Softwarewechsel. | — | FR-42, R-09 |
| **NFR-Ops-02** | Getrennte Entwicklungsumgebungen für Prototyp und Endprodukt sind unterscheidbar; der Prototyp ist als solcher erkennbar und nicht mit produktiven Daten beschickt. | — | C-P.1..P.5 |
| **NFR-Ops-03** | Die Ersetzbarkeit des Providers ist **einmal nachgewiesen**: derselbe nachgelagerte Ablauf funktioniert mit dem gemockten ebenso wie mit dem echten Anbieter. | — | C-P.5 |
| **NFR-Ops-04** | Alle Betriebs- und Wiederherstellungsschritte sind dokumentiert **und geübt**; ein ungeübter Notfallplan gilt als nicht vorhanden. | — | SC-10 |
| **NFR-Ops-05** | Schnittstellen zum ehemaligen Anbieter sind als entfernbar gekennzeichnet, damit zum Stichtag kein Restzugriff verbleibt, der unbemerkt weiterläuft. | — | SC-7, FR-63 |

---

## 3. Business Rules

| Nr. | Regel | Status |
|---|---|---|
| **BR-01** | Die Migrationsquote ist **nicht** 100 % erreichbar. Erreichbar sind maximal **80.000 von 120.000 = 67 %**, da ca. 40.000 Endnutzer keinen Nachweis erbringen können und ausgeschlossen sind. Ein Mindestmigrationswert und ein Maßnahmenplan bei Unterschreitung sind festzulegen. **Empfehlung: ≥ 95 % der registrierungsfähigen Grundgesamtheit.** | **`kann` — out-of-scope bis 2026-10-31 `[OQ-11]`** |
| **BR-02** | Der dauerhafte Ausschluss von ca. 40.000 Endnutzern mit Nicht-EU-Reisepass ist eine **bewusste geschäftliche Entscheidung** des Projektträgers. Ein gesetzlicher Identitätsnachweis ist **nicht** vorgeschrieben; die Ungleichbehandlung ist damit nicht rechtlich gedeckt. | akzeptiert (R-02 offen) |
| **BR-03** | Passkey ist ab dem Stichtag das **einzige** Credential. Ein Ausweich-Credential wird nicht angeboten. | bestätigt |
| **BR-04** | Für Endnutzer der Gruppe A existiert ein **selbstbedienbarer** Recovery-Weg über PENR + Einmalcode (FR-100 ff.). Geräteverlust ohne gültigen Einmalcode bedeutet endgültigen Zugangsverlust. | bestätigt |
| **BR-05** | Die Migration ist **freiwillig**. Eine Nicht-Teilnahme ist bis zum Stichtag zulässig und hat keine unmittelbaren Nachteile. | bestätigt |
| **BR-06** | Der Anspruch auf manuelle Nachregistrierung besteht **nur** für Personen mit deutschem oder EU-Reisepass. Der Kriterium ist die Nachweismöglichkeit, nicht die Nationalität. | bestätigt (R-02 offen) |
| **BR-07** | Die manuelle Nachregistrierung **reaktiviert den bestehenden** Datensatz. Es werden keine neuen Datensätze angelegt. | bestätigt |
| **BR-08** | Migriert werden ausschließlich **Nachname, Vorname, E-Mail-Adresse**. Damit existiert **keine** unveränderliche Verknüpfung zwischen Zugangsdaten und Portal-Stammdaten. **Vorschlag, bis `[OQ-17]` entschieden ist:** E-Mail-Adresse ist **nicht** selbstständig änderbar; eine Änderung erfordert eine erneute Bestätigung über den Anbieter. | **offen — `[OQ-17]`** |
| **BR-09** | Der Stichtag 2027-01-01 ist **extern fix** und nicht verhandelbar. Er ist **irreversibel**: danach existiert kein Rückfall auf den Anbieter. | bestätigt |
| **BR-10** | Der Stichtag ist **kein Compliance-Termin**. Der Handlungsdruck entsteht allein aus der Abschaltung des Anbieters. | bestätigt |
| **BR-11** | Endnutzer-Kommunikation (Brief, E-Mail) ist **manuell** und liegt beim Auftraggeber. Technische Lösung ist nur die Zählung der Quote. | akzeptiert (R-05: Prozessinhaber offen) |
| **BR-12** | Betrieb des Identitätsdatensystems (Installation, Updates, Backup, Monitoring, Wiederherstellung) liegt **in diesem Projekt**. | bestätigt (N-08) |
| **BR-13** | Hochverfügbarkeit und Redundanz sind **kein** Leistungsbestandteil. Ein gemessener Wiederherstellungsnachweis genügt. | bestätigt |
| **BR-14** | Der fachliche Endnutzer-Support (falscher Browser, Geräteverlust, gescheiterte Registrierung) ist **niemandem zugewiesen**. Diese Lücke ist eine **offene Abhängigkeit**, nicht eine akzeptierte Entscheidung. `[OQ-18]` | **offen** |
| **BR-15** | Der manuelle Schalter setzt Personal, Ort und Erreichbarkeit voraus. Ohne diese Festlegung wird der Anspruch aus BR-06/FR-50 **nicht** erfüllbar. `[A-03]` | **offen** |
| **BR-16** | Bei der erstmaligen Passkey-Registrierung ist der **8-12-stellige Einmalcode** auszustellen und dem User zur sicheren Aufbewahrung mitzuteilen. Nur so ist der selbstbedienbare Recovery-Weg (FR-100 ff.) nutzbar. | bestätigt |
| **BR-17** | Der PENR ist realmgebunden. Recovery ist nur innerhalb des korrekten Portals/Realm zulässig. Die Keycloak-Instanz muss entsprechend angepasst werden. | bestätigt |

---

## 4. Permissions

### 4.1 Rollen

| Rolle | Beschreibung | Herkunft |
|---|---|---|
| **R-END** | Endnutzer des Portals | Gruppe A/B/C |
| **R-SWITCH** | Personal am manuellen Schalter | Gruppe D, neu (A-03) |
| **R-OPS** | Technischer Betrieb des Identitätsdatensystems | dieses Projekt (N-08) |
| **R-SUP** | Fachlicher Support für Passkey-Fälle | ungeplant (OQ-18) |
| **R-SYS** | Portal / Integrationsdienst | System |

### 4.2 Berechtigungen

| Berechtigung | R-END | R-SWITCH | R-OPS | R-SUP | R-SYS |
|---|:--:|:--:|:--:|:--:|:--:|
| Portal-Login einleiten | ✓ | ✓ | — | — | — |
| Passkey für **eigenes** Konto registrieren | ✓ | — | — | — | — |
| Geschützten Portalbereich betreten | ✓ | — | — | — | — |
| Eigene Identitätsdaten einsehen | ✓ | — | — | — | — |
| Eigene Identitätsdaten ändern | `BR-08` / `[OQ-17]` | — | — | — | — |
| Registrierungsfrage ablehnen | ✓ | — | — | — | — |
| Identität gegen Reisepass prüfen | — | ✓ | — | — | — |
| Bestehenden Datensatz reaktivieren | — | ✓ | — | — | — |
| Passkey für **fremdes** Konto registrieren | — | ✓ (nur nach FR-51/FR-55) | **—** | **—** | — |
| Neuen Datensatz anlegen | — | **—** | **—** | **—** | — |
| Datensatz an Endnutzer ohne Nachweismöglichkeit reaktivieren | — | **—** | **—** | **—** | — |
| Identitätsfelder einsehen (Name, Vorname, E-Mail) | ✓ | nur im Prüfschritt | eingeschränkt, protokolliert | **—** | zur Synchronisation |
| Passkey-Geheimnis einsehen, exportieren, wiederherstellen | **—** | **—** | **—** | **—** | **—** |
| Installation, Konfiguration, Update des Identitätsdatensystems | — | — | ✓ | — | — |
| Backup auslösen, Backup wiederherstellen | — | — | ✓ | — | — |
| Betriebsprotokolle einsehen | — | — | ✓ | ✓ (Diagnose) | — |
| Migrationsquote / Reports einsehen | — | ✓ | ✓ | — | ✓ |
| Audit-Protokolle (Sperrung, Reaktivierung) einsehen | — | — | ✓ | ✓ (Diagnose) | — |
| Entitlements, Portal-Stammdaten ändern | — | — | — | — | **—** |
| Stichtag / Phasenschalter verändern | — | — | ✓ (protokolliert) | — | ✓ (konfiguriert) |

### 4.3 Berechtigungsgrundsätze

| Nr. | Grundsatz |
|---|---|
| **PR-01** | **Kein Passkey-Geheimnis ist für eine menschliche Rolle einsehbar, exportierbar oder wiederherstellbar.** Diese Zelle ist nicht nur unbegründet, sondern unbesetzbar. |
| **PR-02** | **Keine Rolle darf einen Passkey für ein fremdes Konto registrieren, außer R-SWITCH im Rahmen des Reaktivierungsprozesses** und nur nach erfüllter Identitätsprüfung. |
| **PR-03** | **Kein Support-Backdoor.** R-SUP kann einen Zustand diagnostizieren, aber keinen Zugang herstellen oder umgehen. Ein Passkey-Verlust bleibt für R-SUP unlösbar (BR-04). |
| **PR-04** | **Keine Reaktivierung ohne Nachweis.** Keine technische Funktion umgeht die Reisepassprüfung für BR-06/BR-07. |
| **PR-05** | **Trennung von fachlicher und technischer Verantwortung.** R-OPS besitzt Betriebs- und Datenzugriff, aber keine fachliche Freigabebefugnis über Endnutzerkonten. |
| **PR-06** | **Least Privilege am Stammdatensatz.** R-OPS verändert keine Portal-Stammdaten und keine Entitlements (G-5). |
| **PR-07** | **Alle privilegierten Handlungen sind einzeln protokolliert** und einer benannten Person zuordenbar (Verantwortliche sind namentlich benannt, FR-93). |
| **PR-08** | **Keine Rolle erzeugt Zugang für Endnutzer ohne Nachweis** (BR-02, BR-06) — auch nicht im Notbetrieb (FR-95). |
| **PR-09** | **Der Adesso-Login** bleibt unter der bestehenden Verantwortung und ist nicht Gegenstand dieser Berechtigungsmatrix. `[OQ-10]` |

---

## 5. Constraints

| Nr. | Constraint | Wirkung auf die Anforderungen |
|---|---|---|
| **CO-01** | **2027-01-01 ist extern fix und irreversibel.** | FR-42, NFR-AV-06, BR-09. Keine Rückfallebene nach diesem Datum. |
| **2026-12-31** | Anbieter vollständig verfügbar → Rückfall jederzeit möglich. | FR-02, NFR-AV-05. Verzug des internen Ziels 2026-10-31 erzeugt keinen Projektschaden. |
| **CO-02** | Innere Ziele: Prototyp 2026-10-19, fertig und getestet 2026-10-31. | Gate-Struktur in Abschnitt 6. |
| **CO-03** | **Mobil ausgeschlossen.** | NFR-Env-02. Endnutzer, die ausschließlich mobil nutzen, sind vollständig ausgeschlossen. Menge unbekannt `[OQ-12]`. |
| **CO-04** | Geräteumgebung **nicht kontrolliert**. | NFR-Env-03, BR-04. Geräteverlust = endgültiger Verlust. |
| **CO-05** | Last: 500–1.000 Logins/Monat; ~80.000 Registrierungen / 3 Monate. | NFR-Perf-02. Auslegung darf einfach bleiben. |
| **CO-06** | **Verfügbarkeitsziel nicht definiert** `[OQ-06]`. | NFR-AV-01. **Blockiert** die Betriebsauslegung. |
| **CO-07** | **Hosting-Plattform des Endprodukts offen** `[OQ-04]`. | Blockiert Betrieb und Restore-Nachweis (SC-5). |
| **CO-08** | **Betrieb liegt in diesem Projekt.** | FR-90..FR-95, BR-12, NFR-Ops-04. |
| **CO-09** | Migriert werden **nur** Nachname, Vorname, E-Mail. | FR-14, FR-60, BR-08. Basis von R-11. |
| **CO-10** | Identitätsdatensystem ist nach dem Stichtag **einziger** Speicherort. | FR-63, NFR-Ops-05. |
| **CO-11** | Kein gesetzlicher Identitätsnachweis. | BR-02, BR-06, PR-04. |
| **CO-12** | Keine Eingriffe in Portal-Datenlogik, Entitlement-Logik, Stammdaten. | PR-06, FR-14. |
| **CO-13** | Ausgeschlossen: Adesso-Login, Endnutzer-Kommunikation, neue Portal-Funktionalität, Geräteverwaltung, mobil, Recovery für Gruppe A, HA, rechtliche Verifikation. | NFR-UX, PR-03, NFR-AV-03. |

---

## 6. Acceptance Criteria

### 6.1 Gate A — Prototyp (bis 2026-10-19)

| Nr. | Kriterium | Aus | Nachweis |
|---|---|---|---|
| **AC-P1** | Ein Test-User durchläuft die Migration und kann sich danach mit Passkey anmelden. | FR-11..FR-17 | Testprotokoll |
| **AC-P2** | Ein Test-User lehnt die Registrierung ab und erreicht **ohne** Fehlermeldung und **ohne** Sperrhinweis den geschützten Bereich. | FR-12, BR-05 | Testprotokoll |
| **AC-P3** | Ein Test-User registriert sich zweimal; der zweite Login über Verimi führt **direkt** in den geschützten Bereich — ohne erneute Passkey-Abfrage. *(Änderung 2026-10-08.)* Die Anmeldung mit dem registrierten Passkey wird über den Einstieg „Passkey Login" bzw. in Phase 2 nachgewiesen (AC-P1). | FR-10, FR-16, FR-01 | Testprotokoll |
| **AC-P4** | Die drei Identitätsfelder werden aus dem Anbieter-Mock **vorbefüllt** übernommen. Kein Feld muss abgetippt werden. | FR-13, FR-14 | Testprotokoll |
| **AC-P5** | Passkey funktioniert auf allen unterstützten Desktop-Browsern (Chrome, Edge, Safari, Firefox / Windows, macOS). | NFR-Env-01 | Testprotokoll Matrix |
| **AC-P6** | Der geschützte Bereich wird mit manipuliertem, abgelaufenem oder fehlendem Token **abgewiesen**. | FR-32 | Testprotokoll |
| **AC-P7** | Der Ablauf funktioniert unverändert, wenn statt des Anbieter-Mocks der echte Anbieter eingesetzt wird. | NFR-Ops-03, C-P.5 | Testprotokoll |
| **AC-P8** | Eine Vorabregistrierung eines Passkeys für ein fremdes Konto ist nicht möglich. | NFR-Sec-01, FR-15 | Negativtest |
| **AC-P9** | Das Erreichbarkeitstest-Verfahren ist implementiert und auf der Test-Population anwendbar. | FR-70..FR-73 | Testprotokoll |
| **AC-P10** | Mobil ist **nicht** getestet; die Lücke ist dokumentiert. | NFR-Env-02 | Dokumentierte Lücke |
| **AC-P11** | Für jede der Rollen R-END, R-SWITCH, R-OPS, R-SUP, R-SYS ist die Berechtigungsmatrix aus Abschnitt 4 durch Negativtests belegt. | Abschnitt 4 | Testprotokoll |

### 6.2 Gate B — Produktivgang (zum 2027-01-01)

| Nr. | Kriterium | Aus | Nachweis |
|---|---|---|---|
| **AC-1** | Am Stichtag ist für **keinen** Vorgang ein Login über den Anbieter mehr erforderlich. | FR-01, FR-30 | Produktivtest |
| **AC-2** | Der geschützte Bereich wird ausschließlich mit gültigem Token betreten. | FR-32 | Code-Review + Test |
| **AC-3** | Ein nicht migrierter Endnutzer wird am Stichtag korrekt gesperrt; die Sperrung ist im Protokoll als „mangels Passkey" erkennbar. | FR-40, FR-44 | Produktivtest + Protokoll |
| **AC-4** | Ein Endnutzer mit funktionierendem Passkey wird am Stichtag **nicht** gesperrt. | FR-40 | Produktivtest |
| **AC-5** | Der manuelle Reaktivierungsprozess ist dokumentiert und einsatzbereit **mit benanntem Personal, Ort und Erreichbarkeit**. | FR-53, BR-15 | Prozessdokument |
| **AC-6** | Backup und Wiederherstellung wurden **einmal vollständig durchgespielt**, die Wiederherstellungszeit ist gemessen und dokumentiert; der Wiederanlauf bis zur Anmeldefähigkeit ist geprüft. | FR-91, FR-92, SC-5 | Restore-Protokoll |
| **AC-7** | Die drei Identitätsfelder werden korrekt und ohne Nacharbeit übernommen (Stichprobenabgleich). | FR-60, SC-6 | Datenabgleich |
| **AC-8** | Das Identitätsdatensystem ist der einzige Speicherort; im Regelbetrieb erfolgt kein Abruf beim Anbieter (nachgewiesen durch Code-Review und Netzwerkanalyse). | FR-63, NFR-Ops-05, SC-7 | Code-Review + Netzwerkanalyse |
| **AC-9** | Der Erreichbarkeitstest ist abgeschlossen; für **alle** registrierten Passkeys ist die Anmeldefähigkeit dokumentiert, und Fehlfälle wurden aktiv zurückgerufen **vor** dem Stichtag. | FR-70..FR-74, SC-9 | Testprotokoll |
| **AC-10** | Das Betriebs-Runbook liegt vor und ist **geübt**; der Notbetrieb einschließlich Umgang mit der Irreversibilität des Stichtags ist dokumentiert. | FR-90, FR-95, SC-10 | Runbook |
| **AC-11** | `kann` — bis 2026-10-31 out-of-scope: Die Migrationsquote ist maschinell erhebbar und wurde über die Migrationsphase **wöchentlich** berichtet. | FR-80..FR-81 | Report |
| **AC-12** | `kann` — bis 2026-10-31 out-of-scope: Die Quote erreicht den festgelegten Mindestwert, oder der Maßnahmenplan nach BR-01 ist ausgelöst und dokumentiert. | FR-83, BR-01 | Report + Eskalation |
| **AC-13** | Keine Fehlermeldung und kein Antwortzeitverhalten gibt preis, ob ein Identitätssubjekt existiert oder ob ein Passkey hinterlegt ist. | NFR-Sec-04 | Testprotokoll |
| **AC-14** | Protokolle enthalten keine Passkey-Geheimnisse und keine Klartext-Identitätsfelder. | NFR-Sec-06 | Stichprobe |
| **AC-15** | Jede Reaktivierung am Schalter ist einzeln protokolliert und einer Person zuordenbar. | NFR-Sec-09 | Protokoll |
| **AC-16** | Auftragsverarbeitungsvereinbarung und Löschkonzept liegen vor. | NFR-DS-03, NFR-DS-04 | Dokument |
| **AC-17** | Die betroffenen Abläufe (Login-Einstieg, Registrierungsfrage, Passkey-Bestätigung, Fehlermeldungen) erfüllen WCAG 2.1 AA; Prüfergebnis ist dokumentiert. | NFR-UX-06 | Prüfbericht |

### 6.3 Offene Punkte — blockierend für die Freigabe

Ohne diese Festlegungen sind die jeweils genannten Anforderungen **nicht
freigabereif**:

| Nr. | Offener Punkt | Owner | Benötigt bis | Blockiert |
|---|---|---|---|---|
| **OQ-11** | Mindestmigrationswert festlegen (BR-01). 100 % sind unerreichbar (max. 67 %). **Bis 2026-10-31 out-of-scope — Klärung nicht erforderlich, solange FR-80..83 `kann` sind.** | Auftraggeber | nach 2026-10-31 | BR-01, FR-83, AC-12 (`kann`) |
| **OQ-17** | Änderbarkeit der drei Identitätsfelder (BR-08). | Auftraggeber | **vor Prototypabschluss** | FR-62, AC-7, R-11 |
| **OQ-03** | Authentifizierte Session für die manuelle Reaktivierung. | Auftraggeber | 2026-12-15 | FR-55, FR-52, AC-5 |
| **OQ-04 / OQ-06** | Hosting-Plattform und Verfügbarkeitsziel. | Auftraggeber | 2026-11-15 | NFR-AV-01, FR-91, AC-6 |
| **A-03 / BR-15** | Person, Ort, Schichten für den manuellen Schalter. | Auftraggeber | 2026-11-30 | FR-53, AC-5 |
| **OQ-18 / BR-14** | Fachliche Supportverantwortung. | Auftraggeber | 2026-11-30 | R-SUP, R-12 |
| **OQ-02** | Anzahl Endnutzer mit EU-Reisepass (Größe Gruppe B). | Auftraggeber | 2026-11-30 | Kapazität Schalter, FR-50 |
| **OQ-08 / OQ-09** | AVV und Lösch-/Aufbewahrungskonzept. | Datenschutz | vor Produktivgang | NFR-DS-03/04, AC-16 |
| **OQ-12** | Zahl der ausschließlich mobilen Nutzer. | Auftraggeber | **2026-10-31** | NFR-Env-02 (Grundgesamtheit; BR-01 erst bei Wiederaufnahme des Reportings relevant) |
| **OQ-13** | Sitzungen zum Stichtag. | Auftraggeber | 2026-11-15 | FR-43 |
| **OQ-14** | Befristung des manuellen Prozesses. | Auftraggeber | 2026-12-15 | FR-54 |
| **OQ-15** | Verbindliche Abschaltzusage der Verkäuferin. | Auftraggeber | sofort | gesamte Terminplanung |
| **OQ-16** | Verantwortlicher für den Erreichbarkeitstest. | Auftraggeber | 2026-11-30 | FR-72, AC-9 |

> **Hinweis zur Mehrfachabhängigkeit:** `OQ-12` (Mobilnutzer) verschiebt die
> Grundgesamtheit der betroffenen Endnutzer. Die Auswirkung auf `BR-01` ist
> erst wieder relevant, wenn Migrationsquoten-Reporting nach dem 2026-10-31
> wieder aufgenommen wird; bis dahin ist nur `OQ-12` als solches zu klären.

---

## 7. Bewusst nicht Anforderung

Damit diese Punkte nicht später als ungeplanter Umfang auftauchen, sind sie
hier ausdrücklich als **Nicht-Anforderung** festgehalten:

| Nicht gefordert | Begründung |
|---|---|
| **Migrationsquoten-Reporting (FR-80..FR-83, AC-11, AC-12, BR-01, OQ-11)** | Entscheidung 2026-10-06: bis 2026-10-31 out-of-scope, `kann`-Stufe. Kein Wochentreporting, kein Eskalationsprozess. |
| Hochverfügbarkeit, Redundanz, Failover | BR-13, NFR-AV-03. Ein gemessener Restore-Nachweis genügt. |
| Recovery-Weg für Gruppe A ohne gültigen Einmalcode / bei Verlust beider Werte | BR-04, FR-104 — bewusst out of scope. |
| Mobile Passkeys | CO-03 — Entscheidung des Auftraggebers. |
| Rechtliche Identitätsverifikation | CO-11 — nicht vorgeschrieben. |
| E-Mail-/SMS-Wiederherstellung, Einmalcodes als Credential | BR-03, BR-04. |
| Geräteverwaltung, MDM, kontrollierte Browser | CO-04, CO-13. |
| Neue Portal-Funktionalität, Entitlements, Stammdatenmigration | CO-12. |
| Änderung des Adesso-Logins | CO-13. |
| Reale, statt gemockte, Endnutzer-Kommunikation | BR-11 — Auftraggeber. |