# Market data refresh — 2026-11-06

## Coverage

- All seven MSCI series: September 30 and October 30, 2026 month-ends, plus November 5, 2026 month-to-date (latest level MSCI had published on November 6). The September 24 partial rows were replaced by September 30.
- New: MSCI World Consumer Staples and MSCI World Consumer Discretionary, Net/USD from December 29, 2000 (first Net/USD level served by MSCI for both sectors).
- All 22 Yahoo-backed series: refreshed through November 6, 2026 using the existing adjusted-close downloader. November is partial, not a completed monthly return.
- KMLM: September 30 and October 30 month-ends plus November 6 month-to-date, continuing the existing ETF-linked extension described below. **All 30 configured series now cover October and November.**

## MSCI

Official daily Net/USD levels from:

`https://app2.msci.com/products/service/index/indexmaster/getLevelDataForGraph`

Parameters: `currency_symbol=USD`, `index_variant=NETR`, `data_frequency=DAILY`, `start_date=YYYYMMDD`, `end_date=YYYYMMDD`, `index_codes=<code>`.

| CSV | Official index | October 30 | November 5 |
| --- | --- | --- | --- |
| msci_world.csv | [990100 — World](https://www.msci.com/indexes/index/990100) | 15753.308071115378 | 15423.882862147924 |
| world_momentum.csv | [703755 — World Momentum](https://www.msci.com/indexes/index/703755) | rebased; see CSV | rebased; see CSV |
| world_small_cap.csv | [106230 — World Small Cap](https://www.msci.com/indexes/index/106230) | 956.0604619289827 | 946.9188513176697 |
| world_quality.csv | [702787 — World Quality](https://www.msci.com/indexes/index/702787) | 6343.902935364137 | 6223.704935119838 |
| world_value.csv | [105868 — World Value](https://www.msci.com/indexes/index/105868) | 19553.4083530731 | 19432.907908004185 |
| world_consumer_staples.csv | [106800 — World Consumer Staples](https://www.msci.com/indexes/index/106800) | 585.1245095135238 | 601.942147862757 |
| world_consumer_discretionary.csv | [106799 — World Consumer Discretionary](https://www.msci.com/indexes/index/106799) | 674.7319284815984 | 696.856925300806 |

The two sector series are the plain MSCI World GICS sector indices, not the 35/20 capped variants used by some UCITS ETFs. Their codes were cross-checked against US sector ETFs: October 2026 returns of +10.7% (Staples) / +3.0% (Discretionary) versus XLP +10.9% / XLY +6.0%, consistent with world vs US-only sector exposure. MSCI does not serve dates before 1997; the sector Net/USD series start at the end of 2000. Their CSVs use the 4-line MSCI header without the export disclaimer column.

Momentum's original export is rebased to 100 on January 31, 1997. Its raw official level on that date is 313.9175646; new levels are multiplied by `100 / 313.9175646`. Verified against April–July overlap (minor rounding differences only), avoiding a discontinuity when appending raw levels. Raw October 30/November 5 levels: 6369.6109782000185 / 5816.043962047306.

The refresh script preserves source CSV headers and historical observations, validates the overlapping level, and replaces a partial-month row on later refreshes instead of duplicating it. When a configured CSV does not exist yet, it creates it from the series' first available level with the same gap checks.

## Yahoo Finance

`scripts/fetch-prices.mjs` retrieves monthly adjusted closes from `https://query1.finance.yahoo.com/v8/finance/chart/<ticker>`. Full-history refreshes can revise earlier adjusted prices after distributions or corporate actions; historical differences in `prices.json` are expected.

## KMLM extended history + ETF returns

This is a **hybrid series**, not a verified pure KFA MLM index history. The original user-supplied daily CSV runs from January 1988 through May 8, 2026. Its download source is unconfirmed; Testfolio is plausible, but not established. [Testfolio's documentation](https://testfol.io/help/) identifies `KMLMSIM` / `KMLMX` as simulated KMLM total returns with 0.9% annual expenses. Its analysis endpoint now requires sign-in; no authenticated Testfolio data was retrieved for this refresh.

Repository commit `22d5997` (August 1) already extended May–July using **Yahoo KMLM ETF monthly price returns**, anchored to the April 30 CSV balance of 168696.582. The original task transcript confirms that method. The previous label “KFA MLM Index” was therefore misleading and has been changed to “KMLM (hist. 1988- + ETF)”.

August onward continues that existing ETF-linked series using Yahoo **adjusted** closes, preserving all completed observations. The November 6 refresh re-fetched the anchor: the July 31 and August 31 adjusted closes are unchanged (no distribution since), and the September 24 partial row was replaced by September 30:

| Date | KMLM adjusted close (USD) |
| --- | --- |
| 2026-07-31 | 29.309999465942383 |
| 2026-08-31 | 29.899999618530273 |
| 2026-09-30 | 31.09000015258789 |
| 2026-10-30 | 30.690000534057617 |
| 2026-11-06 | 29.209999084472656 |

Source: `https://query1.finance.yahoo.com/v8/finance/chart/KMLM?period1=1785369600&period2=1794004000&interval=1d&events=div,splits`.

For each new observation: `balance = 166818.381 × adjustedClose(date) / adjustedClose(2026-07-31)`. The CSV return column is the percentage change since the previous monthly endpoint, not a daily return for these appended rows. November is month-to-date (final November 6 close). Balances and return percentages are rounded to six decimals. Re-fetch both anchor and new adjusted closes together to account for future distributions.

See the [KraneShares fund page](https://kraneshares.com/etf/kmlm/). ETF performance includes fees/tracking differences and must not be confused with raw benchmark performance. [Official index history](https://kraneshares.com/kmlm-managed-futures-faq/) remains available on request if a future rebuild of the whole series is desired.
