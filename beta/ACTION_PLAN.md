# Akční plán Energo aplikace

Společný desetibodový **Akční plán** je aktivní od verze 1.7.0. Jednotlivé body se nasazují po etapách a každý větší zásah musí projít regresní sadou.

1. **Architektura a regresní testy — průběžně.** Core moduly jsou oddělené od UI, CI běží na každé relevantní změně a další funkce dostávají vlastní regresní scénáře.
2. **Predikční model spotřeby 2.0 — nasazeno v 1.7.0.** Ensemble kombinuje historii stejného dne v týdnu, posledních 7 dní, posledních 14 dní a průběžné tempo. Váhy se mění podle množství dostupných dat.
3. **Kalibrované predikční pásmo — nasazeno v 1.7.0.** Dokud není dost backtestů, používá se konzervativní heuristika. Od dvou historických chyb se pásmo začne kalibrovat; s dalšími měsíci roste váha empirické chyby.
4. **Rozšířený srovnávací režim — nasazeno v 1.7.0, rozšířeno v 1.7.1.** Hlavní měsíční graf umí bez srovnání, minulý měsíc a stejný měsíc předchozího roku; od 1.7.1 stejné možnosti fungují i v nákladové části včetně oranžové predikce.
5. **Další kumulativní pohledy a cílové trajektorie spotřeby — nasazeno v 1.9.0.** Uživatel může pro konkrétní měsíc zadat cíl v kWh. Denní i kumulativní graf zobrazují samostatnou cílovou trajektorii a stav proti cíli; cíl nijak nemění Forecast 2.0.
6. **Datový health score — nasazeno v 1.7.0.** Měsíční přehled hodnotí kompletnost uzavřených intervalů, použitelnost dat a aktuálnost zdroje.
7. **Detailní finanční model z reálných tarifních složek a PDF faktur — probíhá od 1.6.1.** Lokální E.ON PDF parser, rozpad ceny a ověřený tarif mají přednost před regresí.
8. **Automatická detekce změny režimu spotřeby a adaptace forecastu — nasazeno v 1.8.0.** Model porovnává posledních 7 dní s robustní historickou základnou, vyžaduje konzistentní změnu napříč dny a při potvrzeném posunu upravuje váhy Forecastu 2.0 směrem k posledním 7/14 dnům.
9. **Analýza výkonových maxim, výkonových pásem a vztahu k hlavnímu jističi — nasazeno v 1.10.0.** Analýza DCC1 počítá maximum, P95/P99, čas v pásmech relativně k nastavenému jističi a orientační výkonovou rezervu.
10. **Automatický měsíční report — další etapa.** Skutečnost, historická predikce, odchylka, faktura, maximum a nejsilnější den.

## Verze 1.7.0 — první etapa

První etapa Akčního plánu soustředí změny do predikce a důvěryhodnosti dat:

- Forecast 2.0 (ensemble),
- kalibrace pásma podle rolling backtestu,
- srovnání s minulým měsícem / stejným měsícem loni,
- datový health score,
- rozšířené snapshoty forecastu pro další vyhodnocování.

Body 5, 8, 9 a 10 budou pokračovat v následujících verzích, aby se do jednoho release nemíchalo příliš mnoho nezávislých změn.

## Verze 1.7.2 — Analýza 2.0

- záložka Analýza explicitně ukazuje skutečný rozsah dat, počet dní, intervalů, měsíců a zdroje,
- výchozí režim **Typický profil** používá robustní winsorizované průměry založené na mediánu a MAD,
- extrémní hodnoty se z databáze nemažou; pouze se omezuje jejich vliv na průměrové grafy,
- režim **Všechna data** zachovává čistý aritmetický průměr,
- robustní režim se používá pro dny v týdnu, hodinový profil, heatmapu a rozdělení dne,
- Anomálie spotřeby a Výkonové špičky vždy pracují s původními neočištěnými daty.

## Verze 1.7.4 — oddělení Data a Nastavení

- záložka Data je zjednodušená na operativní práci s daty, měsíci a fakturami,
- technické připojení EG.D, záloha/obnova, aktualizace aplikace a soukromí jsou přesunuté do nové záložky Nastavení,
- v Data zůstává kompaktní stav datového zdroje, jedním tlačítkem lze synchronizovat a druhým otevřít jeho nastavení.

## Verze 1.8.0 — změna režimu spotřeby

- nový modul `core/regime.js` vyhodnocuje trvalejší změny proti robustnímu historickému profilu,
- používají se pouze kompletní uzavřené dny; aktuální neuzavřený den nevstupuje do detekce,
- změna musí být současně dostatečně velká a konzistentní alespoň ve většině posledních 7 dní,
- historie se porovnává podle stejného dne v týdnu a používá robustní střed,
- Analýza ukazuje směr změny, procentní odchylku, důvěru, porovnávaná období a část dne s největší změnou,
- jednorázová špička sama o sobě režim nemění,
- při potvrzené změně Forecast 2.0 automaticky snižuje váhu starší historie a zvyšuje váhu posledních 7/14 dní a aktuálního tempa,
- informace o adaptaci režimu se ukládá i do denních snapshotů forecastu.


## Verze 1.8.1 — audit výpočtů

- denní forecast rozděluje chybějící energii zpět do konkrétních uzavřených dnů s mezerami místo jejího přesunu do budoucích dnů,
- stejná oprava platí pro denní nákladový forecast,
- smíšený den odděluje skutečně naměřenou a dopočtenou část pro korektní modro/oranžové vykreslení,
- hranice posledních dostupných EG.D dat se určuje pouze z použitelných stavů; nepoužitelný pozdější záznam již neposouvá aktuálnost ani forecast,
- regresní testy pokrývají chybějící interval v uzavřeném dni i nepoužitelný EG.D záznam za poslední validní hodnotou.


## Verze 1.9.0 — měsíční cíl spotřeby

- pro každý měsíc lze nastavit samostatný cíl spotřeby v kWh,
- cíl je součástí metadat měsíce, takže přežije EG.D synchronizaci, nahrazení importu i JSON zálohu,
- denní graf zobrazuje cílové denní tempo; rozdělení respektuje délku dne včetně DST 92/96/100 intervalů,
- kumulativní graf zobrazuje cílovou trajektorii končící přesně na zadané hodnotě,
- stav cíle ukazuje průběžnou odchylku vůči trajektorii a u živého měsíce také odchylku Forecastu 2.0 od cíle,
- cílová hodnota je pouze referenční; není vstupem predikčního modelu a neovlivňuje predikci.


## Verze 1.10.0 — výkonová maxima a hlavní jistič

- v Nastavení lze zadat počet fází a jmenovitý proud hlavního jističe,
- referenční činný výkon se počítá pro 1f jako 230 V × I a pro 3f jako √3 × 400 V × I při cos φ ≈ 1,
- Analýza používá výhradně použitelná DCC1 data a ukazuje maximum, P95 a P99 15minutového průměrného výkonu,
- intervaly jsou rozdělené do pásem 0–25 %, 25–50 %, 50–75 %, 75–90 %, 90–100 % a nad 100 % orientační reference,
- zobrazuje se počet intervalů a doba strávená v jednotlivých pásmech,
- konfigurace jističe je součástí lokální JSON zálohy; přístupové údaje EG.D nadále součástí zálohy nejsou,
- aplikace výslovně upozorňuje, že 15minutový průměr DCC1 není měření okamžitého proudu jednotlivých fází a nelze z něj spolehlivě určit vybavení jističe.
