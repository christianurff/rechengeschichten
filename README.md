# Rechengeschichten

Eine Web-App, die Kinder der Klassen 1–6 beim **Verstehen und Lösen mathematischer
Sachaufgaben** begleitet. Die Aufgabe wird eingegeben oder fotografiert, danach
stehen verschiedene, didaktisch begründete Wege zur Verfügung – angelehnt an die
Sachrechen-Konzepte von [PIKAS](https://pikas.dzlm.de/unterricht/groessen-und-messen/sachsituationen):

- **Text verstehen** – die Aufgabe gemeinsam erschließen, Wichtiges markieren
- **Fragen stellen** – passende Fragen zur Situation finden
- **Lösen helfen** – schrittweise begleiten, ohne die Lösung vorwegzunehmen
- **Lösung prüfen** – das eigene Ergebnis auf Plausibilität abklopfen
- **Kapitänsaufgabe** – unsinnige Aufgaben erkennen
- **Eigene Aufgabe** – selbst eine Sachaufgabe schreiben
- **Visualisieren** – die Situation mit Plättchen handelnd nachbauen

Dazu kommen ein Lesemodus mit Silbentrennung und Vorlesefunktion, ein Notizbereich,
Wörterklärungen mit Bild, mehrsprachige Unterstützung und Urkunden als PDF.

Vanilla HTML/CSS/JavaScript, **kein Build-Schritt, keine Abhängigkeiten**.

## Schnellstart

```bash
git clone https://github.com/<dein-account>/rechengeschichten.git
cd rechengeschichten
open index.html          # reicht zum Ausprobieren
```

Für Kamera-Upload und Spracheingabe braucht der Browser einen sicheren Kontext.
Lokal genügt `localhost`:

```bash
python3 -m http.server 8420 --bind 127.0.0.1
# http://127.0.0.1:8420
```

Im Web muss die App über **HTTPS** ausgeliefert werden. Es genügt, die Dateien auf
einen beliebigen Webspace zu legen – ein Server-Backend gibt es nicht.

## KI-Zugang einrichten

Die App bringt **keinen** KI-Zugang mit. Ohne eigenen Zugang funktionieren Lesemodus,
Notizen und Plättchen, die KI-gestützten Wege bleiben aus. Den Zugang trägst du in
der App unter **Einstellungen → API-Zugang** ein; er wird nur lokal im Browser
(`localStorage`) gespeichert und nie an Dritte weitergegeben.

| Weg | Was nötig ist | Kann |
| --- | --- | --- |
| **Google AI Studio** (empfohlen) | kostenloser API-Key von [aistudio.google.com](https://aistudio.google.com/apikey) | Text + Bilder |
| **Groq** | API-Key von [console.groq.com](https://console.groq.com) | Text + Bilder + Spracheingabe (Whisper) |
| **Eigener Proxy** | URL eines selbst betriebenen, OpenAI-kompatiblen Endpunkts | je nach Modell |

> **Achtung:** Ein API-Key im Browser ist für jede Person einsehbar, die Zugriff auf
> das Gerät hat. Für den Einsatz in einer Klasse oder öffentlich ist deshalb der
> Proxy-Weg der richtige: ein kleiner serverseitiger Dienst (z. B. ein Cloudflare
> Worker), der den Schlüssel hält und die Anfragen weiterreicht. Die App schickt
> dann nur noch an deine eigene URL. Ein solcher Proxy ist schnell gebaut – er muss
> lediglich `POST /chat/completions` im OpenAI-Format entgegennehmen, den
> `Authorization`-Header serverseitig setzen und CORS erlauben.

Welche Modelle verwendet werden, steht am Anfang von `api.js`. Alle KI-Aufrufe
laufen durch **eine** Funktion – `kiChatCompletion()` –, dort lässt sich ein
weiterer Anbieter mit wenigen Zeilen ergänzen.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html` | Gesamte Oberfläche (Markup + Dialoge) |
| `app.js` | UI-Logik und Zustand |
| `api.js` | Alle KI-Aufrufe und Prompts, Anbieterauswahl |
| `styles.css` | Gestaltung |
| `quantity-visualizer.js/.css` | Plättchen-Engine für den Visualisieren-Modus |
| `visualization-prompts.js` | Prompts für das Visualisieren |
| `visualization-guard.js` | Fail-closed-Prüfung der KI-Pläne vor der Darstellung |
| `reader-text-view.js/.css` | Lesemodus mit Silbentrennung und Vorlesen |
| `multilingual.js/.css` | Mehrsprachige Erklärungen |
| `note-pad.js`, `inline-note-sheet.js` | Notizfläche und Zeichnen |
| `matheforscher-bridge.js` | postMessage-Protokoll für die Einbettung per iframe |
| `hyphenopoly/`, `hyph-de-1996.pat.txt` | Deutsche Silbentrennung |
| `vendor/` | jsPDF, lz-string, qrcode.js |
| `symbole/` | Icons der Oberfläche |
| `test/` | Unit-Tests und KI-Testskripte |

Der Visualisieren-Modus ist bewusst eng gefasst: Er wird nur für Grundaufgaben mit
zählbaren Objekten und höchstens zwei Rechenschritten angeboten. `visualization-guard.js`
prüft jeden von der KI gelieferten Plan und verwirft ihn im Zweifel, statt Kindern
eine falsche Darstellung zu zeigen.

## Tests

```bash
node --test test/*.test.js     # Unit-Tests, ohne Netz
node --check app.js            # Syntaxprüfung
```

Die Skripte `test/ai-*.js` prüfen die Qualität der KI-Antworten gegen einen echten
Endpunkt und brauchen deshalb einen eigenen Zugang:

```bash
RG_PROXY_URL=https://mein-proxy.example.dev node test/ai-plan-quality-test.js
```

## Unterschiede zur Originalversion

Diese Veröffentlichung enthält den Kern der App. Nicht enthalten sind:

- **Die Schriftart.** Das Original nutzt die Fibelschrift *ABeZeh EDU*, die
  kommerziell lizenziert ist. Die App fällt auf eine Systemschrift zurück. Wie du
  eine eigene Schulschrift einbindest, steht als Kommentar oben in `styles.css`.
  Frei lizenzierte Fibelschriften sind z. B. *ABeeZee*, *Andika* oder die
  [Grundschrift](https://github.com/christianurff/grundschrift).
- **Das Forschungsmodul.** Die Originalversion erhebt nach gesonderter Einwilligung
  pseudonymisierte Nutzungsdaten für ein Forschungsprojekt. Diese Version erhebt
  **keine Daten** und sendet nichts außer den KI-Anfragen an den von dir
  eingetragenen Anbieter.
- **Die iOS-App** und die Proxy-Dienste des Originals.

## Als Betreiber beachten

Wer die App öffentlich bereitstellt, ist selbst für **Impressum und
Datenschutzerklärung** verantwortlich. Der Erststart-Dialog in `index.html` enthält
an der passenden Stelle einen auskommentierten Platzhalter für den Link. Zu nennen
ist dort insbesondere, welcher KI-Dienst die Eingaben verarbeitet.

## Lizenz

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.de) –
Namensnennung, nicht kommerziell. Siehe [LICENSE](LICENSE).

> Basiert auf „Rechengeschichten" von Christian Urff ([urff.app](https://urff.app)),
> lizenziert unter CC BY-NC 4.0.

Weiterentwickeln, anpassen und in der eigenen Schule einsetzen ist ausdrücklich
erwünscht. Die Fußzeile der App nennt die Ursprungsversion – bitte lass diesen
Hinweis stehen.

Mitgelieferte Bibliotheken stehen unter ihren eigenen (MIT-)Lizenzen, siehe LICENSE.
