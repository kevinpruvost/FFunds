import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(`../src/data/${name}`, import.meta.url), "utf8");
const prices = JSON.parse(read("prices.json"));
const config = JSON.parse(read("tickers.config.json"));

test("all configured series cover August and September 2026 with unique valid months", () => {
  assert.deepEqual(Object.keys(prices).sort(), config.map(entry => entry.ticker).sort());
  for (const [ticker, series] of Object.entries(prices)) {
    const dates = series.monthly.map(row => row.date);
    assert.deepEqual(dates, [...new Set(dates)].sort(), ticker);
    assert.equal(series.startDate, dates[0], ticker);
    assert.equal(series.endDate, dates.at(-1), ticker);
    for (const month of ["2026-08", "2026-09"]) assert.ok(dates.includes(month), ticker);
    for (const row of series.monthly) {
      assert.match(row.date, /^\d{4}-(0[1-9]|1[0-2])$/);
      assert.ok(Number.isFinite(row.close) && row.close > 0, ticker);
    }
  }
});

test("baked CSV series equal the last observation of each month", () => {
  for (const entry of config.filter(entry => entry.csv)) {
    const byMonth = new Map();
    for (const line of read(entry.csv).trimEnd().split(/\r?\n/).slice(entry.ticker === "KMLM" ? 1 : 4)) {
      const columns = line.split(",");
      byMonth.set(columns[0].slice(0, 7), Number(columns[entry.ticker === "KMLM" ? 2 : 1]));
    }
    assert.deepEqual(prices[entry.ticker].monthly,
      [...byMonth].map(([date, close]) => ({ date, close })), entry.ticker);
  }
});

test("KMLM additions preserve the ETF-linked scale and total-return ratios", () => {
  const anchor = 166818.381;
  const anchorPrice = 29.309999465942383;
  const observed = [["2026-08-31", 29.899999618530273], ["2026-09-24", 31.06999969482422]];
  const rows = read("kmlm.csv").trimEnd().split(/\r?\n/).map(line => line.split(","));
  let previous = anchorPrice;
  for (const [date, adjustedClose] of observed) {
    const row = rows.find(row => row[0] === date);
    assert.ok(row, date);
    assert.ok(Math.abs(Number(row[2]) - anchor * adjustedClose / anchorPrice) <= 0.0000005);
    assert.ok(Math.abs(Number(row[1]) - (adjustedClose / previous - 1) * 100) <= 0.0000005);
    previous = adjustedClose;
  }
});
