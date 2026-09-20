# Energo Přehled Beta 1.7 – architektura

## Cíl verze 1.7

Verze 1.7 navazuje na modularizaci 1.6 a zahajuje Akční plán. Výpočetní logika zůstává oddělená od UI; Forecast 2.0 a kalibrace nejistoty jsou čisté funkce v core vrstvě a jejich integrace je krytá regresními scénáři.

## Moduly

- `core/model.js` – čisté matematické funkce, převody kW/kWh, kalendářní pomocné funkce a cenová regrese.
- `core/time.js` – Europe/Prague, převod lokálního času na UTC kandidáty a DST 92/96/100 intervalů.
- `core/forecast.js` – Forecast 2.0 ensemble, kalibrace nejistoty z backtestů, rozdělení měsíční predikce do dní a kumulativní transformace.
- `core/power.js` – čistá analýza 15minutového DCC1 výkonu, percentilů, výkonových pásem a orientační reference hlavního jističe.
- `core/report.js` – čistá agregace uzavřeného měsíce pro automatický report a vyhodnocení historického forecast snapshotu.
- `core/finance-analytics.js` – čistá finanční analytika nad fakturami: efektivní cena, fixní/variabilní ekonomika, rozpad složek, stáří tarifu a tarifní most.
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


## Měsíční cíl a cílová trajektorie (1.9.0)

Měsíční cíl spotřeby se ukládá jako `energyTargetKwh` přímo v metadatech konkrétního měsíce. Při opakovaném importu nebo EG.D synchronizaci se hodnota zachová stejně jako finanční data a historie forecastu. Proto je automaticky součástí běžné JSON zálohy, aniž by bylo nutné zálohovat citlivé EG.D přihlašovací údaje.

Čistá funkce `Forecast.targetTrajectory(total, weights, cumulative)` rozděluje cíl podle očekávaného počtu 15minutových intervalů jednotlivých dnů. Běžný den má váhu 96, jarní DST den 92 a podzimní 100. Denní trajektorie tak respektuje skutečnou délku dne a kumulativní varianta vždy končí přesně na měsíčním cíli.

Cíl je pouze vizualizační a vyhodnocovací reference. Nevstupuje do Forecastu 2.0, nemění ensemble váhy ani predikční pásmo.


## Výkonová analýza a hlavní jistič (1.10.0)

`core/power.js` zůstává čistý a nezávislý na DOM. Pro zadaný počet fází a jmenovitý proud vypočítá orientační referenční činný výkon: pro jednofázovou soustavu `230 × I`, pro třífázovou `√3 × 400 × I`. Jde o referenci při přibližně jednotkovém účiníku a u třífázové varianty za předpokladu rozumně vyváženého zatížení.

Analýza v UI používá vždy DCC1 a pouze použitelné intervaly. Počítá maximum, P95, P99, poměr maxima k referenčnímu výkonu a dobu v pásmech 0–25 %, 25–50 %, 50–75 %, 75–90 %, 90–100 % a nad 100 %. Hodnota nad 100 % není interpretována jako důkaz vybavení jističe: EG.D data představují 15minutové průměry činného výkonu a neobsahují okamžitý proud jednotlivých fází, nesymetrii, účiník ani krátkodobé rozběhové proudy.

Nastavení jističe se ukládá do IndexedDB pod klíčem `power-config` a je součástí uživatelské JSON zálohy. Citlivá konfigurace EG.D zůstává od zálohy oddělená.


## Automatický měsíční report (1.11.0)

`core/report.js` dostává normalizované použitelné intervaly DCC1, uloženou fakturu, případný měsíční cíl a již existující forecast snapshot. Z těchto vstupů čistě dopočítá skutečnou energii, maximum výkonu, nejsilnější den, efektivní cenu a odchylky forecastu.

Historický forecast se nikdy negeneruje zpětně. `app.js` předává modulu snapshot vybraný funkcí `evaluationForecast()`, tedy přednostně zhruba sedm dní před koncem měsíce. Pokud snapshot neexistuje, report tuto část označí jako nedostupnou. Tím se zachovává auditovatelnost backtestu.

Report je odvozený pohled nad existujícími daty a nevytváří nový persistentní zdroj pravdy. Kopírovaný text se generuje až v UI z aktuálního reportového objektu.


## Finance Analytics 2.0 (1.12.0)

`core/finance-analytics.js` závisí pouze na `core/invoice.js` a nepracuje s DOM. Vstupem je skutečná měsíční DCC1 spotřeba a normalizované finanční schéma. Ručně zadaná celková faktura proto dovoluje spočítat efektivní cenu, ale detailní fixní/variabilní ekonomika se aktivuje jen tehdy, když `Invoice.hasValidatedTariff()` potvrzuje ověřený tarif.

Pro dva po sobě použitelné validované tarify modul počítá aditivní tarifní most:

- vliv spotřeby = předchozí variabilní sazba × změna kWh,
- vliv variabilní ceny = změna sazby za kWh × aktuální spotřeba,
- vliv fixu = změna měsíční fixní částky.

Součet těchto tří vlivů přesně odpovídá změně modelované faktury `F + V × E`. Rozdíl proti skutečné změně faktury zůstává explicitní jako reziduum a neskrývá se v žádné komponentě.

Stáří zdrojového PDF tarifu se počítá v kalendářních měsících. Nemění spotřební Forecast 2.0 ani samotnou tarifní rovnici, ale snižuje zobrazovanou důvěru finančního odhadu: nejnovější tarif má plnou důvěru, starší tarif postupně menší. Zdrojový měsíc a stáří jsou viditelné v UI.


## Finance Forecast 2.0 (1.13.0)

Střední hodnota nákladového forecastu se nemění: u validovaného tarifu je stále `F + V × E`, kde `F` je měsíční fix, `V` variabilní sazba v Kč/kWh a `E` střední predikce spotřeby. U statistického modelu zůstává zdrojem omezená nezáporná regrese historických faktur.

Nová funkce `FinanceAnalytics.expandCostBand()` přidává druhou osu nejistoty k již existujícímu spotřebnímu pásmu. U čerstvého validovaného tarifu může být cenová nejistota nulová; s rostoucím stářím tarifu a nižší confidence se pásmo symetricky rozšiřuje. U regresního modelu se používá konzervativnější minimum a šířka roste s klesající confidence. Střední predikce se touto operací neposouvá.

Finanční dopad měsíčního cíle používá tentýž cenový model jako hlavní forecast. U validovaného tarifu se proto mění pouze variabilní část `V × E`; fixní složka `F` zůstává v obou scénářích. To zabraňuje nadhodnocování potenciální úspory při nižší spotřebě.

Forecast snapshot od 1.13.0 navíc ukládá `costModelType`, `financeConfidence`, `priceUncertainty`, `tariffSourceMonth` a `tariffAgeMonths`. Tyto hodnoty jsou auditní metadata a neovlivňují zpětně starší snapshoty. Měsíční report je pouze čte a zobrazuje.


## Model audit a metodické opravy (1.13.1)

### Forecast bez historie
Pokud ještě neexistuje kompletní historický měsíc, Forecast 2.0 již nevrací pouze dosavadní skutečnost jako údajnou celoměsíční predikci. Baseline se odvodí z kompletních dní aktuálního měsíce; pokud ani ty nejsou, použije se průběžné intervalové tempo. Historická weekday komponenta zůstává v ensemble skutečně nedostupná a nevstupuje do vah jako nula.

### Kalibrace predikčního pásma
Kalibrační backtest je oddělen od reportového výběru snapshotu. Pro kalibraci se používají pouze snapshoty s `forecastModel = ensemble-v2` a horizontem 5–9 dní před koncem měsíce, preferenčně co nejblíže 7 dnům. Používá se omezená poslední historie, aby velmi staré generace chování nerozmělňovaly aktuální model. Měsíční report nadále smí použít nejlepší dostupný snapshot i tehdy, když přesný sedmidenní neexistuje.

### Mezery v uzavřených dnech
Dopočet chybějících intervalů není omezen výrazem `max(0, expectedDay - actualDay)`. Chybějící počet slotů dostane kladný odhad založený na kombinaci typické energie na slot a již pozorovaného tempa dne. Tím nadprůměrný den s jedním chybějícím intervalem nedostane implicitní nulu.

### Kompletní dny v analytice
Metriky, které interpretují celý den — dny v týdnu, části dne, denní robustní dopad a denní anomálie — používají jen kompletní uzavřené dny s očekávanými 92/96/100 intervaly podle DST. Hodinové a intervalové analýzy mohou nadále pracovat s dostupnými jednotlivými intervaly.

### Potvrzení režimu
`core/regime.js` rozlišuje `candidate` a `changed`. Krátké 7denní okno může vytvořit kandidáta, ale `strength` zůstává nulová a Forecast 2.0 váhy nemění. Stav `changed` vznikne až tehdy, když delší potvrzovací okno podporuje stejný směr a dostatečnou konzistenci.

### Historická alokace skutečných nákladů
U kompletního měsíce s validovaným PDF tarifem se historický náklad rozděluje jako `V × E_selected + F × timeFraction`. Rozdíl mezi modelovaným `F + V × E` a skutečnou fakturou se alokuje časově. Tím se zachová přesný měsíční součet faktury, ale fixní platby se už nerozdělují podle spotřeby. Bez validovaného tarifu zůstává fallback efektivní Kč/kWh.

### Finanční confidence
Stáří tarifu a kvalita PDF extrakce jsou oddělené veličiny. Stáří ovlivňuje `agePart`, zatímco `extractionConfidence` ovlivňuje pouze quality část cenové nejistoty. Zobrazená celková confidence může stále kombinovat kvalitu a freshness, ale výpočet nejistoty věk nezapočítává podruhé.

U historické cenové regrese platí `blend = confidence`. Pokud je confidence nulová, dynamická regresní složka má nulovou váhu a výpočet používá fallback efektivní sazbu.
