# PDF faktury – import a tarifní model

Od verze 1.6.1 je aktivní lokální import textových PDF faktur E.ON Energie.

## Uživatelský tok

U každého uzavřeného měsíce lze:

1. zadat celkovou částku faktury ručně, nebo
2. zvolit **Načíst PDF**, nechat fakturu lokálně vytěžit a před uložením zkontrolovat rozpoznané údaje.

Samotný PDF soubor se neposílá na server aplikace. Pro extrakci textové vrstvy se při prvním použití načte PDF.js z připnuté verze na jsDelivr.

## Aktuálně podporovaný parser

`eon-cz-1.0.0` je kalibrovaný na reálnou řádnou měsíční fakturu E.ON Energie za elektřinu.

Parser čte a kontroluje:

- celkovou částku s DPH a bez DPH,
- fakturační období, číslo dokladu, variabilní symbol, datum vystavení a splatnosti,
- EAN a spotřebu z faktury,
- produkt, distribuční sazbu a hlavní jistič,
- silovou elektřinu a stálý plat dodavatele,
- daň z elektřiny, distribuci podle spotřeby, plat za jistič a systémové služby,
- nesíťovou infrastrukturu, POZE, DPH a případné nerozpoznané zbytkové položky.

Naskenované PDF bez textové vrstvy zatím není podporované.

## Validační pravidla

Před uložením se kontroluje zejména:

- rozpoznání dodavatele E.ON Energie,
- fakturační období a jeho shoda se zvoleným kalendářním měsícem,
- celková částka faktury,
- součet cenových složek proti částce bez DPH a výsledku s DPH,
- EAN proti intervalovým datům měsíce, pokud je k dispozici,
- rozdíl spotřeby na faktuře proti intervalovým datům.

Faktura přesahující více kalendářních měsíců se nyní neuloží automaticky, protože finanční databáze je vedená po měsících.

## Tarifní model

Z ověřené faktury se odvozují dvě ceny včetně DPH:

- fixní cena v Kč/měsíc,
- variabilní cena v Kč/kWh.

Pro další průběžný měsíc má nejnovější ověřený tarif stejného odběrného místa přednost před statistickou regresí faktur. Predikce nákladů pak používá vztah:

`fixní část + variabilní cena × predikovaná spotřeba`

Statistický model zůstává fallbackem, pokud strukturovaná faktura nebo validní tarif nejsou k dispozici.

## Kompatibilita

Staré záznamy s pouhou `finance.invoiceTotal` zůstávají podporované. Ruční změna celkové částky po PDF importu automaticky zneplatní odvozený tarif, aby aplikace nepoužívala model, který už neodpovídá uložené faktuře.