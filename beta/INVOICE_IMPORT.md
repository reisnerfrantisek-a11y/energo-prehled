# PDF faktury – připravený datový model

PDF import bude aktivován až po ověření parseru na reálné faktuře.

## Vstupy pro měsíc

Uživatel bude moci zvolit jednu ze dvou cest:

1. ručně zadat pouze celkovou částku faktury,
2. nahrát PDF fakturu a nechat aplikaci lokálně vytěžit fakturační údaje a cenové složky.

## Pole připravená ve verzi 1.6

- celková částka a měna,
- dodavatel,
- číslo dokladu / variabilní symbol,
- fakturační období, datum vystavení a splatnosti,
- dodávka silové elektřiny,
- distribuce za odebranou energii,
- systémové služby,
- POZE,
- daň z elektřiny,
- stálý plat dodavatele,
- plat za jistič,
- stálé distribuční platby,
- DPH,
- ostatní položky,
- zdroj údajů `manual/pdf/import`,
- verze parseru, stav extrakce a její confidence.

## Validační pravidla PDF parseru

Parser nesmí fakturu automaticky přijmout, pokud:

- nerozpozná fakturační období,
- součet cenových složek neodpovídá celkové částce v toleranci zaokrouhlení,
- nelze jednoznačně přiřadit fakturu k měsíci / odběrnému místu,
- význam některé významné položky je nejasný.

V takovém případě nabídne uživateli vyčtené údaje ke kontrole a ruční opravě.

## Budoucí cenový model

Po nasbírání strukturovaných faktur se cenová predikce nebude opírat jen o regresi „fix + Kč/kWh“. Výpočet bude možné skládat z reálných tarifních složek a statistický model zůstane hlavně pro predikci spotřeby.
