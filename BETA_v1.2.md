# Energo Přehled – Beta 1.2

## Novinky

- Hromadný import více XLSX souborů najednou.
- Soubory se zpracovávají postupně, aby se zbytečně nezatěžovala paměť iPhonu.
- Kontrola společného EAN a duplicitních měsíců při hromadném importu.
- Jednotné rozhodnutí nahradit / přeskočit již existující měsíce.
- Globální volba období: Měsíc / 3 měsíce / Rok / Vlastní / Vše.
- Zvolené období řídí současně dashboard i záložku Analýza.
- Volba období se pamatuje mezi spuštěními.
- Měsíční dashboard podporuje swipe vlevo/vpravo mezi měsíci i šipky.
- Klepnutím na středový popisek období lze otevřít výběr měsíce.
- Vlastní období umožňuje přesné datum Od–Do.
- Rozdělení dne lze zobrazit jako procenta nebo průměrné kWh/den.
- Záloha nově uchovává i nastavení období a režim grafu Rozdělení dne.
- Produkční a beta Service Worker používají oddělené cache namespaces.
- Přidána bezpečná migrace cache ze starších verzí.

## Datová pravidla

Všechny kontroly z Beta 1.1 zůstávají zachované: 15min mřížka, DST Europe/Prague, kompletnost měsíce, duplicity, EAN isolation, atomické nahrazení a validace DCC0/DCC1.
