# Market data refresh — 2026-09-25

## Coverage

- All five MSCI series: August 31, 2026 month-end and September 24, 2026 month-to-date.
- All 22 Yahoo-backed series: refreshed through September 2026 using the existing adjusted-close downloader. September is partial, not a completed monthly return. Intraday availability can differ between markets.
- KMLM: August 31 month-end and September 24 month-to-date, continuing the existing ETF-linked extension described below. **All 28 configured series now cover August and September.**

## MSCI

Official daily Net/USD levels from:

`https://app2.msci.com/products/service/index/indexmaster/getLevelDataForGraph`

Parameters: `currency_symbol=USD`, `index_variant=NETR`, `data_frequency=DAILY`, `start_date=YYYYMMDD`, `end_date=YYYYMMDD`, `index_codes=<code>`.

| CSV | Official index | August 31 | September 24 |
| --- | --- | --- | --- |
| msci_world.csv | [990100 — World](https://www.msci.com/indexes/index/990100) | 16066.435946741227 | 15953.728355526537 |
| world_momentum.csv | [703755 — World Momentum](https://www.msci.com/indexes/index/703755) | rebased; see CSV | rebased; see CSV |
| world_small_cap.csv | [106230 — World Small Cap](https://www.msci.com/indexes/index/106230) | 993.7079842135197 | 958.6609043451363 |
| world_quality.csv | [702787 — World Quality](https://www.msci.com/indexes/index/702787) | 6386.542553644693 | 6379.00187950242 |
| world_value.csv | [105868 — World Value](https://www.msci.com/indexes/index/105868) | 19486.21383600393 | 19233.77537001295 |

Momentum's original export is rebased to 100 on January 31, 1997. Its raw official level on that date is 313.9175646; new levels are multiplied by `100 / 313.9175646`. Verified against April–July overlap (minor rounding differences only), avoiding a discontinuity when appending raw levels. Raw August/September levels: 6706.510664234021 / 6932.908957076046.

The refresh script preserves source CSV headers and historical observations, validates the overlapping level, and replaces a partial-month row on later refreshes instead of duplicating it.

## Yahoo Finance

`scripts/fetch-prices.mjs` retrieves monthly adjusted closes from `https://query1.finance.yahoo.com/v8/finance/chart/<ticker>`. Full-history refreshes can revise earlier adjusted prices after distributions or corporate actions; historical differences in `prices.json` are expected.

## KMLM extended history + ETF returns

This is a **hybrid series**, not a verified pure KFA MLM index history. The original user-supplied daily CSV runs from January 1988 through May 8, 2026. Its download source is unconfirmed; Testfolio is plausible, but not established. [Testfolio's documentation](https://testfol.io/help/) identifies `KMLMSIM` / `KMLMX` as simulated KMLM total returns with 0.9% annual expenses. Its analysis endpoint now requires sign-in; no authenticated Testfolio data was retrieved for this refresh.

Repository commit `22d5997` (August 1) already extended May–July using **Yahoo KMLM ETF monthly price returns**, anchored to the April 30 CSV balance of 168696.582. The original task transcript confirms that method. The previous label “KFA MLM Index” was therefore misleading and has been changed to “KMLM (hist. 1988- + ETF)”.

August and September continue that existing ETF-linked series using Yahoo **adjusted** closes, preserving all previous observations. Both daily and monthly Yahoo responses agree on these observations:

| Date | KMLM adjusted close (USD) |
| --- | --- |
| 2026-07-31 | 29.309999465942383 |
| 2026-08-31 | 29.899999618530273 |
| 2026-09-24 | 31.06999969482422 |

Source: `https://query1.finance.yahoo.com/v8/finance/chart/KMLM?period1=1785456000&period2=1790294400&interval=1d&events=div,splits`.

For each new observation: `balance = 166818.381 × adjustedClose(date) / adjustedClose(2026-07-31)`. The CSV return column is the percentage change since the previous monthly endpoint, not a daily return for these appended rows. September is month-to-date. Balances and return percentages are rounded to six decimals. Re-fetch both anchor and new adjusted closes together to account for future distributions.

The [KraneShares fund page](https://kraneshares.com/etf/kmlm/) independently reports the September 24 market price of $31.07. ETF performance includes fees/tracking differences and must not be confused with raw benchmark performance. [Official index history](https://kraneshares.com/kmlm-managed-futures-faq/) remains available on request if a future rebuild of the whole series is desired.
