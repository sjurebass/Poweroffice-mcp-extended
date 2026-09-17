# Oppsett

Praktisk guide for å få denne MCP-serveren til å kjøre lokalt mot PowerOffice Go.
Se [README.md](./README.md) for hva serveren faktisk kan gjøre og hvor
sikkerhetsgrensen går.

Serveren kjører som en lokal Node.js-prosess på din egen maskin. Den snakker med
PowerOffice over HTTPS, og med AI-assistenten over stdio. Ingenting hostes noe
sted, og ingen andre kan koble seg på den.

---

## 1. Du trenger tre nøkler

| Nøkkel | Hvor den kommer fra | Merk |
|---|---|---|
| **Subscription key** | developer.poweroffice.net — din egen portalkonto | Fast. Ulik for demo og produksjon. |
| **Application key** | Sendes på e-post fra PowerOffice når integrasjonen er registrert | Vises **én gang**. Identifiserer integrasjonen, ikke selskapet. |
| **Client key** | I PowerOffice Go, når integrasjonen aktiveres på en klient | Vises **én gang**, i en dialogboks. Kopier før du trykker OK. |

Application key får du **ikke** inne i PowerOffice Go — den kommer fra
PowerOffice sitt API-team etter at integrasjonen er registrert. Det er porten
inn, og den tar tid (1–2 uker for produksjon).

### Demo

1. Opprett konto på https://developer.poweroffice.net → gir subscription key.
2. Fyll ut demo-skjemaet (Getting started, steg 2).
3. PowerOffice sender application key, en test-klient i Go og en brukerinvitasjon.
   I demo får du som regel client key ferdig utdelt, siden de setter opp
   test-klienten for deg.

### Produksjon

Egne nøkler, eget miljø, egen godkjenning. Demo-nøkler virker ikke i produksjon
og omvendt. Kontakt go-api@poweroffice.no, fyll ut produksjonsskjemaet og signer
utviklervilkårene.

### Aktivere på en klient (der client key kommer fra)

1. Logg inn i Go som bruker med **administratorrolle**, eller med rettigheten
   `Innstillinger → Organisasjon`. Uten det virker ikke menyvalget.
2. **Meny → Innstillinger → Utvidelser → Legg til utvidelse**
3. Dette er en intern integrasjon, så den dukker **ikke** opp i søkelista. Velg
   **«Egendefinert utvidelse»**.
4. Lim inn application key.
5. Go viser hvilke privilegier integrasjonen ber om. Les dem, godta.
6. **Client key vises i et vindu. Kopier den nå.** Trykker du OK er den saltet,
   hashet og borte for godt — også for PowerOffice.

Én client key per selskap. Samme application key for alle.

---

## 2. Bygg serveren

Krever Node.js 20 eller nyere.

```bash
git clone https://github.com/sjurebass/Poweroffice-mcp-extended.git
cd Poweroffice-mcp-extended
npm install
npm run build
npm test
```

---

## 3. Legg inn nøklene

Nøklene leses fra miljøvariabler. De skal **aldri** inn i dette repoet.

### Ett selskap

```bash
export POWEROFFICE_API_URL="https://goapi.poweroffice.net/Demo"  # demo
# export POWEROFFICE_API_URL="https://goapi.poweroffice.net"     # produksjon
export POWEROFFICE_APP_KEY="..."
export POWEROFFICE_CLIENT_KEY="..."
export POWEROFFICE_SUBSCRIPTION_KEY="..."
node dist/index.js
```

### Flere selskaper

Lag en JSON-fil utenfor repoet, for eksempel `~/.poweroffice-mcp/clients.json`:

```json
{
  "apiUrl": "https://goapi.poweroffice.net",
  "appKey": "...",
  "subscriptionKey": "...",
  "defaultClient": "firma1",
  "clients": {
    "firma1": { "label": "Firma 1 AS", "clientKey": "..." },
    "firma2": { "label": "Firma 2 AS", "clientKey": "..." }
  }
}
```

```bash
chmod 600 ~/.poweroffice-mcp/clients.json
export POWEROFFICE_CLIENTS="$HOME/.poweroffice-mcp/clients.json"
```

`appKey` og `subscriptionKey` er felles. `clientKey` er unik per selskap.
Aliaset (`firma1`) er det du oppgir som `client`-argument i verktøyene.

---

## 4. Koble til Claude Code

Legg dette inn under `mcpServers` i `~/.claude.json`:

```json
"poweroffice-go": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolutt/sti/til/Poweroffice-mcp-extended/dist/index.js"],
  "env": {
    "POWEROFFICE_CLIENTS": "/Users/DITTNAVN/.poweroffice-mcp/clients.json"
  }
}
```

Bruk `POWEROFFICE_API_URL`, `POWEROFFICE_APP_KEY`, `POWEROFFICE_CLIENT_KEY` og
`POWEROFFICE_SUBSCRIPTION_KEY` i `env`-blokken i stedet, hvis du bare har ett
selskap.

Vil du heller holde nøklene ute av `~/.claude.json`, lag et lite skall-skript som
laster dem fra en fil med `chmod 600` og peker `command` på skriptet. Slike
skript hører hjemme lokalt, ikke i repoet.

Start Claude Code på nytt. Sjekk at det virker:

- **`list_companies`** — hvilke selskaper serveren er satt opp for. Svares
  lokalt, uten å kontakte PowerOffice.
- **`get_integration_info`** — hva PowerOffice mener om nøkkelen du bruker:
  hvilken klient den hører til og hvilke privilegier den har. Bruk denne til å
  bekrefte at du peker på selskapet du tror du peker på.

---

## 5. Sånn bruker du den

Hvert verktøy tar et `client`-argument — aliaset fra `list_companies`.

- **Lesing** kan utelate det hvis `defaultClient` er satt.
- **Skriving må alltid oppgi selskap eksplisitt** når flere er satt opp, også når
  det finnes en default. Å bokføre på feil selskap er dyrt å oppdage og kjedelig
  å rette, så serveren nekter å gjette.
- **Bokføring og sletting krever `confirm=true`.** Det er en fartsdump mot en
  feiltolket instruksjon, ikke en sikkerhetskontroll.
- **Posterte bilag rettes med `reverse_voucher`**, ikke sletting — slik
  bokføringsreglene krever.

Typisk flyt for et manuelt bilag: `list_gl_accounts` for å finne kontoene →
`get_lock_date` for å sjekke at perioden er åpen → `create_voucher_draft` →
`add_voucher_line` → `post_voucher` med `confirm=true`.

---

## 6. Hva serveren ikke kan

Med vilje, håndhevet ved at verktøyene ikke finnes i koden:

- sende faktura, kreditnota eller purring
- inkasso
- opprette eller slette bankoverføringer — bankdata er kun lesbart
- endre klientens bankkontoer eller bankgodkjennere

Å utvide dette krever en kodeendring, en kodegjennomgang og en ny utrulling.
Ingen prompt, flagg eller innstilling kommer rundt det.

---

## 7. Sikkerhet

- **Client key er et passord.** Den gir tilgang til ett selskaps regnskap. Ligger
  den i klartekst på maskinen din, er en stjålet maskin en stjålet nøkkel.
  Lekker den: deaktiver utvidelsen i Go og aktiver på nytt for å få en ny.
- **Nøkler skal aldri inn i repoet.** `.gitignore` dekker `.env`-filer, men den
  sikreste vanen er å holde nøkkelfilene utenfor repomappa helt.
- **Alt logges lokalt** i `~/.poweroffice-mcp/audit.log` (styres med
  `POWEROFFICE_AUDIT_LOG`): tidspunkt, verktøy, argumenter, utfall, varighet.
  Loggen sendes ingen steder. Argumenter logges, ikke svar.
- **Utkast er ekte data.** `create_customer`, `create_voucher_draft` og resten
  havner i det virkelige regnskapet. Ingenting går ut til en kunde uten at et
  menneske trykker send i Go, men postene er reelle.
- **Bruker du en AI-assistent i skyen**, sendes innholdet fra API-svarene —
  kundenavn, beløp, lønnsdata — til leverandøren av modellen. Det er en reell
  dataflyt å ta stilling til før produksjon, særlig for lønn.

---

## Feilsøking

| Feil | Betyr som regel |
|---|---|
| `OAuth token request failed (HTTP 401)` | Feil nøkkel, eller nøkler blandet mellom demo og produksjon. De tre nøklene må være fra samme miljø. |
| `Unknown client "x"` | Aliaset finnes ikke i `clients.json`. Kjør `list_companies`. |
| `This tool writes to the accounts, so it must name the company` | Skriveoperasjon uten `client`-argument. Oppgi selskapet. |
| `Refused: ... Re-run with confirm=true` | Bokføring eller sletting uten bekreftelse. Bekreft med brukeren først, så sett `confirm=true`. |
| `PowerOffice API error 403` | Integrasjonen mangler privilegiet. Må endres der utvidelsen ble aktivert i Go. |
| Postering avvises på dato | Sjekk `get_lock_date` — perioden kan være låst. |

Sett `POWEROFFICE_DEBUG=1` for å få med PowerOffice sin egen feilmelding i
feilteksten. Den kan inneholde kundedata, så la den stå av til vanlig.
