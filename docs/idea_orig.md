# Problem:
Verimi - ein Anbieter zur Authentifizierung - will Ende diesen Jahres seinen Dienst einstellen. Meine Firma ist von dem Dienst abhängig zur Authentifizierung der User in ein Portal. Daher soll der Prozess von Verimi mit einen neuen Prozess ersetzt werden.

Das bisherige Prozess und wie das ganze System aufgebaut ist (Status Quo), ist im folgenden Diagramm zu sehen:
`../_keycloak_info/system-architektur.md` bzw. `../_keycloak_info/system-architektur.svg`

Es gibt noch die Möglichkeit sich mittels Adesso einzuloggen, aber das ignorieren wir hier.

## Affected user

| Gruppe | Volumen | Bezug zum Problem |
|---|---|---|
| Kunden / Endnutzer des Portals | >= 120.000 | Kein Firmen-Account, geringe technische Affinität, keine kontrollierte Geräteumgebung |
| User mit ausländischem Pass | ca. 40.000 (30% vom gesamten Kundenstamm) | Kein ID-Nachweis möglich; laut Ausgangsidee ohne Lösungsansatz |

Nicht betroffen: externe Partner/Lieferanten, Service-Accounts und Maschinen-zu-Maschinen-Authentifizierung. Das Portal ist der einzige Konsument vom verimi Endpunkt.

# Lösung

## Bis zum 31.12.2026

Bis Ende des Jahres, werden alle User benachrichtigt sich bei Keycloak einen Passkey zu registrieren. Wer danach es immer noch nicht getan hat, kann sich nicht mehr einloggen oder muss einen neuen Login beantragen. Dies kann mit Pass oder Ausweis gemacht werden.

Prozess kann im folgenden Diagramm gesehen werden: `../_keycloak_info/verimi-ablosung-flow.drawio.svg`

## Ab dem 01.01.2027
Ab dem neuen Jahr wird Verimi komplett abgeschaltet. User, die vorher sich bei keycloak für Passkey registriert haben, können über Passkey sich einloggen. Diejenigen, die es nicht geschafft haben vor 2027 neu zu registrieren, müssen sich noch mal mit Ausweis oder Pass sich einen neuen Nutzer-Account erstellen lassen.

Diejenigen mit ausländischen Pass können leider nicht nachträglich registriert werden. (das ist ein großer Nachteil zu dem es noch keinen Lösungsansatz gibt)

Prozess kann im folgenden Diagramm gesehen werden: `../_keycloak_info/passkey-flow.drawio.svg`

# Umsetzungsidee
Ein Prototyp muss innerhalb von 2 Wochen fertig sein. Die Lösung muss bis Ende Oktober 2026 fertig und getestet sein. 

## Prototyp
- Keycloak mit Passkey muss aufgesetzt sein.
- Verimi Prozess mocken
- Test User erstellen
- Testen

### Bestandteile des Prototypen
Der Prototyp besteht aus verschiedenen Subsystemen. Jedes System ist ein eigener Service, der z.B. auf Docker laufen kann.

#### Portal-Mock 
Das ist das wo die User sich einloggen können. Es besteht aus einem Login-Button (der von Verimi bzw. - im Falle des Prototype - einen Verimi Mock authentifiziert wird). Falls die authentifizierung funktioniert, dann kommt der user in einen für ihn geschützten Bereich, wo seine privaten Daten stehen. Im Falle des Prototypen, reicht es aus, wenn dieser geschützter Bereich seinen Namen anzeigt. Denn es geht hier nur darum zu testen, ob man verimi ersetzen kann.

Wenn wir später im Prozess sind Verimi-Mock (siehe unten) mit Keycloak ersetzen (die Phase von jetzt bis zum 31.12.2026), dann soll nach der erfolgreichen Authentifizierung dem User gefragt werden - falls er noch nicht bei Keycloak registriert ist - , ob er sich bei Keycloak registrieren will oder nicht. Falls nein, dann soll er wie vorher auch ins Portal weitergeleitet werden. Falls er sich auf Keycloak registrieren will, dann sollen die Infos von Verimi-Mock, z.B. Username, Vorname, Nachname übernommen werden, sodass der User die Infos nicht eintippen muss. Falls er schon bei Keycloak registriert ist, dann soll er statt über Verimi (bzw. in unserem Fall den Verimi-Mock) zu gehen, eine Seite angzeigt bekommen, wo er ein Passkey Form gezeigt bekommt, wo er sich mit Passkey einloggen kann.

#### Verimi-Mock
Der Verimi Mock dient dazu die Authorisierung am Portal zu mocken. Eine vorherige Registrierung des Nutzers ist nicht notwendig. Der Mock soll eine vorabgefüllte Datenbank mit einen Username und Password enthalten. Dies soll so einfach halten wie möglich, weil es sich hier nur um einen Mock handelt. Falls die Authentifizierung erfolgreich war, dann soll an eine bestimmte URL weitergeleitet werden. Zur Zeit auf den geschützten Bereich des Portals (also dort wo der User-Bereich ist). Später werden wir denselben Endpunkt nutzen, um statt auf den geschützten Bereich des Portals weiterzuleiten, auf die Keycloak Registrierungsseite bzw. auf die neue Passkey Authentifizierung (als den Ersatz zu Verimi) weiterzuleiten. 

#### Keycloakd + Passkey
Das ist das Herzstück des Prototypen. Dies soll kein Mock sein, sondern so nah wie möglich am Endprodukt sein. Dieser Service bietet die Möglichkeit, dass der user - nachdem er von Verimi-Mock authentifiziert wurde und wenn er sich bei Keycloak noch nicht registriert hat - sich bei KeyCloak registrieren kann. Falls er sich schon auf Keycloak registriert hat, dann kann er sich über Passkey anmelden.

## Endprodukt
- Anbindung Keycloak mit Verimi
- Testen