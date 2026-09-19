# Energo Přehled Beta 1.6 – architektura

## Cíl verze 1.6

Verze 1.6 odděluje stabilní výpočetní logiku od UI monolitu tak, aby se další vývoj dal testovat bez prohlížeče a aby změna jedné části aplikace nerozbíjela EG.D synchronizaci, DST nebo predikce.

## Moduly

- `core/model.js` – čisté matematické funkce, převody kW/kWh, kalendářní pomocné funkce a cenová regrese.
- `core/time.js` – Europe/Prague, převod lokálního času na UTC kandidáty a DST 92/96/100 intervalů.
- `core/forecast.js` – rozdělení měsíční predikce do dní, predikční pásmo a kumulativní transformace.
- `core/invoice.js` – zpětně kompatibilní finanční schéma, detailní cenové složky a ověřený tarif.
- `core/invoice-parser.js` – lokální textový parser podporovaných PDF faktur a validační pravidla.
- `app.js` – orchestrace IndexedDB, EG.D, UI a vykreslování. Čisté výpočty deleguje do core modulů.

## Regresní ochrana

CI workflow `.github/workflows/test-beta-core.yml` používá Node 20 a při každém relevantním push/PR kontroluje:

- syntaxi aplikace a konzistenci verze,
- vazby HTML ID ↔ JS,
- DST 92/96/100,
- ICQ2 kWh ↔ kW,
- statusy EG.D B/W a vyřazení nepoužitelných IU statusů,
- zpětnou kompatibilitu finančních dat,
- parser PDF faktur, součty cenových složek a tarifní sazby,
- rozdělení predikce, predikční pásmo a kumulativní graf,
- srovnávací řadu s minulým měsícem.

## UI 1.6

Hlavní měsíční graf spotřeby podporuje:

- Denní / Kumulativní,
- modrou skutečnost,
- oranžovou predikci,
- světle oranžové predikční pásmo,
- volitelné srovnání s minulým měsícem.

## Zásada kompatibility

Stávající IndexedDB se nemaže. Staré záznamy `finance.invoiceTotal` a původní čtyři finanční komponenty se při načtení normalizují do rozšířeného schématu bez ztráty dat.
