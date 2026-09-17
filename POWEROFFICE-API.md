# PowerOffice Go API v2 — verifisert oppsett (demo)

Alt under er testet mot demo-miljøet 17.09.2026 og ga HTTP 200.

## Miljø

| | |
|---|---|
| Token-endepunkt | `https://goapi.poweroffice.net/Demo/OAuth/Token` |
| Base-URL | `https://goapi.poweroffice.net/demo/v2` |
| GUI (demo) | https://godemo.poweroffice.net/ |
| Utviklerportal | https://developer.poweroffice.net |
| Swagger | https://swagger.poweroffice.net |
| Klientnavn | Silfer AS - API Test Client |
| Abonnement | SilferAs-Demo |

Nøkler ligger i `~/.poweroffice-mcp/clients.json` (chmod 600, utenfor repoet).
Fire verdier trengs: applicationKey, clientKey, clientId, subscriptionKey.
Se [OPPSETT.md](./OPPSETT.md) for filformatet.

## Autentisering

OAuth2 client_credentials med **Basic auth**, der brukernavn/passord er
`applicationKey:clientKey` base64-kodet. I tillegg må Azure APIM-headeren
`Ocp-Apim-Subscription-Key` være med på **både** token-kallet og alle API-kall.

```
POST /Demo/OAuth/Token
Authorization: Basic base64(applicationKey + ":" + clientKey)
Ocp-Apim-Subscription-Key: <subscriptionKey>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Svar: `{"access_token":"...","token_type":"bearer","expires_in":1200}`

**Token varer kun 20 minutter** — må caches og fornyes automatisk.

Videre kall:
```
Authorization: Bearer <access_token>
Ocp-Apim-Subscription-Key: <subscriptionKey>
```

## Tilganger på testklienten

Aktive moduler: Accounting, TimeTracking, Payroll, TravelExpense, HolidayAndLeave.

Roller er `_Full` på nær sagt alt — inkludert `BankTransfer_Full`, `ManualVoucher_Full`,
`VoucherApproval_Full`, `SalaryLine_Full`, `OutgoingInvoice_Full`. Dette er skrivetilgang
til betalinger, bilag og lønn.

Sperret av PowerOffice: `goAllowSendInvoice=False`, `goAllowShowCustomerSSN=False`,
`goAllowShowEmployeeSSN=False`.

## Query-parametre

Verifisert på Customers, gjelder generelt for GET-lister:

- `PageSize` og `PageNumber` — paginering
- `Fields` — kommaseparert felt-utvalg, f.eks. `Fields=Id,Name`
- `OrderBy`
- `lastChangedDateTimeOffsetGreaterThan` / `createdDateTimeOffsetGreaterThan` —
  for inkrementell polling av endringer

OData-stil (`$top`, `$skip`) gir **HTTP 400**.

## API-områder (45 spec-filer)

Hentes som `https://swagger.poweroffice.net/openapispecs/<navn>.json`:

accountingsettings, accounttransactions, banktransfers, budgets, clientadmin,
clientbankaccounts, clientintegrationinformation, clientdocuments, contactbankaccounts,
contactdeliveryaddresses, contactgroups, contactpersons, contactshareholders, contactubos,
customdimensions, customerledger, customers, departments, employees, enterprises, imports,
incominginvoices, itemtransactions, journalentryvouchers, locations, onboarding, offboarding,
organizationsettings, outgoinginvoices, payroll, products, projects, quality, salarylines,
salesorders, salessettings, supplierledger, suppliers, timetracking, timetransactions,
trialbalance, voucherapproval, voucherdocumentation, voucherposting

## Test-snutt

```bash
API=$(node -p "require(process.env.HOME+'/.poweroffice-mcp/clients.json').apiUrl")
APP=$(node -p "require(process.env.HOME+'/.poweroffice-mcp/clients.json').appKey")
SUB=$(node -p "require(process.env.HOME+'/.poweroffice-mcp/clients.json').subscriptionKey")
CK=$(node -p "require(process.env.HOME+'/.poweroffice-mcp/clients.json').clients['silfer-demo'].clientKey")

BASIC=$(printf "%s:%s" "$APP" "$CK" | base64 -w0)
TOKEN=$(curl -s -X POST "$API/OAuth/Token" \
  -H "Authorization: Basic $BASIC" \
  -H "Ocp-Apim-Subscription-Key: $SUB" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=client_credentials" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

curl -s "$API/v2/Customers?PageSize=5&Fields=Id,Name" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Ocp-Apim-Subscription-Key: $SUB"
```

## Fra demo til produksjon

Bytt `Demo`/`demo` ut med produksjonsstien i de to URL-ene og bruk
produksjonsnøklene. Applicationkey er lik på tvers; clientKey er per klient,
så ved flere regnskapskunder må serveren kunne holde flere clientKeys.
