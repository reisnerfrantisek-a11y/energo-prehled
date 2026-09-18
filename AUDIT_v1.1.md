# Energo Přehled v1.1 – data hardening

Opravy po technickém auditu:

- striktní 15minutová časová osa pro Europe/Prague
- přesná podpora změny letního/zimního času (92/96/100 intervalů podle skutečného dne)
- detekce chybějících dnů, intervalů a nepovolených duplicit
- odmítnutí neplatných/blank DCC0 a DCC1 hodnot
- vyhledání datového listu a rolí místo pevných sloupců
- ukládání DCC0, DCC1, DKC0, DKC1, DMC0, DMC1
- ochrana proti smíchání různých EAN
- atomická náhrada již importovaného měsíce
- korektní srovnání měsíc / 3 měsíce / rok pouze při kompletních datech
- základní odběr sjednocen na 00:00–06:00
- export CSV s českou desetinnou čárkou
- XLSX export obsahuje i původních šest profilů
- záloha a obnova lokální databáze
- network-first aktualizace hlavních PWA souborů
- automatické smoke testy pro syntaxi a DST validaci

Stabilní produkční verze zůstává na větvi `main`.
