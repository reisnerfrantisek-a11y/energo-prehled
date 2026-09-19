# Energo Přehled – EG.D proxy

Malá Vercel Function pro PWA Energo Přehled.

## Bezpečnostní model

- Proxy přijímá požadavky pouze z originu `https://reisnerfrantisek-a11y.github.io`.
- Neobsahuje žádné EG.D přístupové údaje v repozitáři.
- `client_id` a `client_secret` přicházejí z PWA přes HTTPS pouze během požadavku a proxy je neukládá.
- Proxy dovoluje pouze pevně definované akce `diagnostics` a `spotreby`; není to obecný HTTP relay.
- Rozsah `spotreby` je omezen na max. 35 dní a `pageSize=3000`.
- Odpovědi mají `Cache-Control: no-store`.

## Nasazení na Vercel

Importuj GitHub repo `reisnerfrantisek-a11y/energo-prehled` a nastav **Root Directory** na:

`vercel-egd-proxy`

Projekt nepotřebuje žádné environment variables ani secrets.

Po deployi vznikne URL např. `https://energo-egd-proxy.vercel.app`.
Do Energo Přehled pak vlož adresu endpointu:

`https://energo-egd-proxy.vercel.app/api/egd`
