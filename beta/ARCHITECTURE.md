# Energo Přehled Beta 1.7 – architektura

## Cíl verze 1.7

Verze 1.7 navazuje na modularizaci 1.6 a zahajuje Akční plán. Výpočetní logika zůstává oddělená od UI; Forecast 2.0 a kalibrace nejistoty jsou čisté funkce v core vrstvě a jejich integrace je krytá regresními scénáři.

## Moduly

- `core/model.js` – čisté matematické funkce, převody kW/kWh, kalendářní pomocné funkce a cenová regrese.
- `core/time.js` – Europe/Prague, převod lokálního času na UTC kandidáty a DST 92/96/100 intervalů.
- `core/forecast.js` – Forecast 2.0 ensemble, kalibrace nejistoty z backtestů, rozdělení měsíční predikce do dní a kumulativní transformace.
- `core/invoice.js` – zpětně kompatibilní finanční schéma, detailní cenové složky a ověřený tarif.
- `core/invoice-parser.js` – lokální textový parser podporovaných PDF faktur a validační pravidla.
- `app.js` – orchestrace IndexedDB, EG.D, UI a vykreslování. Čisté výpočty deleguje do core modulů.

## Regresní ochrana

CI workflow `.github/workflows/test-beta-core.yml` používá Node 24 a při každém relevantním push/PR kontroluje:

- syntaxi aplikace a konzistenci verze,
- vazby HTML ID ↔ JS,
- DST 92/96/100,
- ICQ2 kWh ↔ kW,
- statusy EG.D B/W a vyřazení nepoužitelných IU statusů,
- zpětnou kompatibilitu finančních dat,
- parser PDF faktur, součty cenových složek a tarifní sazby,
- rozdělení predikce, predikční pásmo a kumulativní graf,
- srovnávací řadu s minulým měsícem i stejným měsícem předchozího roku,
- Forecast 2.0 ensemble a kalibraci pásma,
- datový health score.

## UI 1.7

Hlavní měsíční graf spotřeby podporuje:

- Denní / Kumulativní,
- modrou skutečnost,
- oranžovou predikci,
- světle oranžové predikční pásmo,
- volitelné srovnání s minulým měsícem nebo stejným měsícem loni ve spotřebě i nákladech,
- nákladový hlavní graf používá stejně jako spotřeba modrou skutečnost, oranžovou predikci a predikční pásmo,
- datový health score pro vybraný měsíc,
- stručný popis složení Forecastu 2.0 a zdroje predikčního pásma.

## Zásada kompatibility

Stávající IndexedDB se nemaže. Staré záznamy `finance.invoiceTotal` a původní čtyři finanční komponenty se při načtení normalizují do rozšířeného schématu bez ztráty dat.

## Analysis 2.0 (1.7.2)

Průměrové analytické grafy mají dvě explicitní metody:

- `robust` — výchozí typický profil; skupinové průměry jsou winsorizované pomocí robustních hranic z mediánu a MAD,
- `raw` — aritmetický průměr všech hodnot bez korekce extrémů.

Robustní výpočet pouze omezuje vliv odlehlých hodnot ve výsledném průměru. Zdrojové intervaly se nemění a moduly anomálií i výkonových špiček je nadále používají beze změny. Pro malé vzorky se robustní metoda automaticky vrací k aritmetickému průměru, aby z několika hodnot nevytvářela falešný filtr.

## Navigace Data / Nastavení (1.7.4)

`Data` je operativní obrazovka pro import, měsíce, faktury a rychlou synchronizaci. `Nastavení` obsahuje dlouhodobou konfiguraci a servisní funkce: EG.D OpenAPI připojení, automatickou synchronizaci, zálohu/obnovu, aktualizaci aplikace a informace o soukromí. Tím se odděluje běžná práce s daty od technické konfigurace.

## Regime change engine (1.8.0)

`core/regime.js` je čistý modul bez závislosti na DOM. Vstupem jsou kompletní denní souhrny se spotřebou a pěti částmi dne. Modul:

- sestaví robustní baseline podle dne v týdnu z předchozí historie,
- odhadne přirozenou variabilitu historických reziduí,
- vyhodnotí velikost a konzistenci změny v posledním 7denním okně,
- používá delší okno jako potvrzení směru změny,
- určí část dne s největším absolutním posunem,
- vrátí sílu adaptace 0–1.

Forecast 2.0 nepřebírá detekovaný poměr mechanicky. Síla změny pouze převažuje existující ensemble: starší weekday baseline dostává nižší váhu a recent 7/14 dní vyšší. Tím se předchází tomu, aby jediný extrém okamžitě přepsal měsíční predikci.


## Forecast gap allocation (1.8.1)

Forecast denního průběhu pracuje odděleně s naměřenou a predikovanou složkou. Zbývající měsíční predikce se rozděluje nejen do budoucích dnů, ale i do konkrétních chybějících částí uzavřených dnů a případného neuzavřeného dne. Součet denních hodnot proto zůstává přesně svázaný s centrálním měsíčním forecastem, zatímco graf může skutečnost vykreslit modře a dopočet oranžově.

`lastAvailableAt` reprezentuje poslední použitelnou EG.D hodnotu, nikoliv pouze nejnovější raw záznam. Nepoužitelné kvalitativní stavy tak neovlivňují freshness, snapshot boundary ani začátek nákladové predikce.
