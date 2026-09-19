# Akční plán Energo aplikace

Tento dokument je společný desetibodový **Akční plán**. Aktivně jej začneme plnit až po vydání stabilní verze 1.6.0.

1. Dál zpevňovat architekturu a regresní testy při každé větší změně.
2. Predikční model spotřeby 2.0: ensemble historie dne v týdnu + posledních 7/14 dní + průběžné tempo.
3. Kalibrované predikční pásmo podle skutečných historických chyb modelu.
4. Rozšířený srovnávací režim: minulý měsíc a stejný měsíc předchozího roku.
5. Další kumulativní pohledy a cílové trajektorie spotřeby.
6. Datový health score s jednoduchým souhrnem kvality, mezer a aktuálnosti.
7. Detailní finanční model z reálných tarifních složek a PDF faktur.
8. Automatická detekce změny režimu spotřeby a adaptace forecastu.
9. Analýza výkonových maxim, výkonových pásem a vztahu k hlavnímu jističi.
10. Automatický měsíční report se skutečností, historickou predikcí, odchylkou, fakturou, maximem a nejsilnějším dnem.

## Poznámka k verzi 1.6.0

Verze 1.6.0 je technický základ před zahájením Akčního plánu: modularizace čistých výpočtů, automatické regresní testy a připravené UI prvky pro predikční pásmo, kumulativní zobrazení a základní porovnání s minulým měsícem.
