import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runBacktest, runComparison, getComparisonPeriod } from "../src/lib/portfolioBacktest.ts";

const defaults = {
  initialInvestment: 190000, monthlyContribution: 0, rebalance: "annual",
  marginEnabled: false, marginLeverage: 1, marginLoanRate: 0,
  marginInterestFreq: "monthly", marginRebalance: false,
  marginRebalanceMode: "bidirectional", marginMaintenancePct: 25,
  inflationPct: 2.5, windowMode: "all", yearsBack: 10,
  customStart: "", customEnd: "", contribStopYears: 0,
};
const input = (tickers, overrides = {}) => ({ ...defaults, tickers, weights: tickers.map(() => 100 / tickers.length), ...overrides });
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const history = (start, intervals, annualReturn) => {
  const date = new Date(`${start}-01T00:00:00Z`);
  const monthly = Array.from({ length: intervals + 1 }, (_, i) => {
    const month = new Date(date);
    month.setUTCMonth(month.getUTCMonth() + i);
    return { date: month.toISOString().slice(0, 7), close: 100 * (1 + annualReturn) ** (i / 12) };
  });
  return { startDate: monthly[0].date, endDate: monthly.at(-1).date, monthly };
};
const fixture = {
  LONG: history("2000-01", 36, 0.08),
  SHORT: history("2001-01", 24, 0.10),
};

test("CAGR matches final/initial raised to elapsed years without contributions", () => {
  const result = runBacktest(input(["LONG"]), fixture);
  near(result.cagr, 0.08);
  near(result.cagr, (result.finalValue / defaults.initialInvestment) ** (12 / (result.months.length - 1)) - 1);
  near(result.realCagr, 1.08 / 1.025 - 1);
});

test("different inception dates share one starting capital, period and inflation base", () => {
  const inputs = [input(["LONG"]), input(["SHORT"])];
  const independent = inputs.map(value => runBacktest(value, fixture));
  assert.ok(independent[0].finalValue > independent[1].finalValue);
  assert.ok(independent[0].cagr < independent[1].cagr);
  const [long, short] = runComparison(inputs, fixture);
  assert.equal(long.startMonth, "2001-01");
  assert.equal(long.endMonth, "2003-01");
  assert.deepEqual(long.months, short.months);
  assert.equal(long.equityValue[0], short.equityValue[0]);
  near(long.totalInvestedReal, short.totalInvestedReal);
  assert.ok(short.finalValue > long.finalValue && short.cagr > long.cagr);
});

test("comparison aligns end dates as well as start dates", () => {
  const prices = { ...fixture, EARLY_END: history("1999-01", 36, 0.05) };
  const [a, b] = runComparison([input(["SHORT"]), input(["EARLY_END"])], prices);
  assert.equal(a.startMonth, "2001-01");
  assert.equal(a.endMonth, "2002-01");
  assert.deepEqual(a.months, b.months);
});

test("last N years contains N*12 return intervals, not one month fewer", () => {
  const result = runBacktest(input(["LONG"], { windowMode: "lastN", yearsBack: 1 }), fixture);
  assert.equal(result.months.length, 13);
  assert.equal(result.startMonth, "2002-01");
  near(result.finalValue / defaults.initialInvestment, 1.08);
});

test("custom date windows stay common, and disjoint windows return no result", () => {
  const params = { windowMode: "custom", customStart: "2002-06", customEnd: "2001-06" };
  const [a, b] = runComparison([input(["LONG"], params), input(["SHORT"], params)], fixture);
  assert.equal(a.startMonth, "2001-06");
  assert.equal(a.endMonth, "2002-06");
  assert.deepEqual(a.months, b.months);
  assert.equal(runBacktest(input(["LONG"], { ...params, customStart: "2030-01", customEnd: "2031-01" }), fixture), null);
  assert.deepEqual(runComparison([input(["LONG"]), input(["FUTURE"])], {
    ...fixture, FUTURE: history("2040-01", 12, 0.1),
  }), [null, null]);
});

test("contributions do not count as investment return and have identical schedules", () => {
  const params = { monthlyContribution: 500, contribStopYears: 1 };
  const [a, b] = runComparison([input(["LONG"], params), input(["SHORT"], params)], fixture);
  near(a.cagr, 0.08);
  near(b.cagr, 0.10);
  assert.deepEqual(a.invested, b.invested);
  assert.deepEqual(a.investedReal, b.investedReal);
  assert.equal(a.totalInvested, defaults.initialInvestment + 12 * 500);
});

test("empty portfolios do not shorten comparison; missing data invalidates it", () => {
  const [a, b] = runComparison([input(["LONG"]), input([])], fixture);
  assert.equal(a.startMonth, "2000-01");
  assert.equal(b, null);
  assert.equal(getComparisonPeriod(fixture, [["MISSING"], ["LONG"]]), null);
});

test("cash-only simulation has a finite calendar and zero return", () => {
  const result = runBacktest(input(["CASH"]), { CASH: fixture.LONG });
  near(result.cagr, 0);
  assert.equal(result.finalValue, defaults.initialInvestment);
  const [cash, stock] = runComparison([input(["CASH"]), input(["LONG"])], {
    ...fixture, CASH: history("2010-01", 12, 0),
  });
  assert.deepEqual(cash.months, stock.months);
  assert.equal(cash.finalValue, defaults.initialInvestment);
});

test("real Golden Ratio vs SPY data reproduce the period mismatch and align correctly", () => {
  const prices = JSON.parse(readFileSync(new URL("../src/data/prices.json", import.meta.url), "utf8"));
  const golden = input(["MSCI-WORLD-MOMENTUM", "MSCI-WORLD-SMALL", "MSCI-WORLD-QUALITY", "XLU", "TLT", "SHY", "KMLM", "GLD"], {
    weights: [20, 9, 10, 10, 14, 6, 15, 16],
  });
  const spy = input(["SPY"]);
  const oldSpy = runBacktest(spy, prices);
  assert.equal(oldSpy.startMonth, "1999-01");
  const [a, b] = runComparison([golden, spy], prices);
  assert.equal(a.startMonth, "2004-11");
  assert.equal(b.startMonth, "2004-11");
  assert.deepEqual(a.months, b.months);
  near(a.totalInvestedReal, b.totalInvestedReal);
  assert.equal(Math.sign(a.finalValue - b.finalValue), Math.sign(a.cagr - b.cagr));
  for (const result of [a, b]) near(result.cagr,
    (result.finalValue / defaults.initialInvestment) ** (12 / (result.months.length - 1)) - 1);
});

test("near-liquidation re-leverage repays only inside the buffer and reports the closest call", () => {
  // -5 % every month, 2x leverage, 25 % maintenance: liquidation at assets = loan / 0.75.
  const prices = { FALL: history("2000-01", 24, 0.95 ** 12 - 1) };
  const margin = { tickers: ["FALL"], weights: [100], initialInvestment: 100000, rebalance: "none",
    inflationPct: 0, marginEnabled: true, marginLeverage: 2, marginRebalance: true };
  const gainsOnly = runBacktest(input(["FALL"], { ...margin, marginRebalanceMode: "gains-only" }), prices);
  assert.equal(gainsOnly.liquidationMonth, "2000-09");
  assert.equal(gainsOnly.deleverageCount, 0);
  near(gainsOnly.liquidationValueSeries[0], 100000 / 0.75, 1e-6);
  near(gainsOnly.liquidationDistanceSeries[0], 1 / 3);
  assert.ok(gainsOnly.minLiquidationDistance <= 0);

  const buffered = runBacktest(input(["FALL"], { ...margin, marginRebalanceMode: "near-liquidation",
    marginLiquidationBufferPct: 10 }), prices);
  assert.equal(buffered.liquidationMonth, null);
  // Distance after k falls: 1 - (2/3) / 0.95^k, first below 10 % at k = 6.
  assert.deepEqual(buffered.loanAmountSeries.slice(0, 6), Array(6).fill(100000));
  assert.ok(buffered.loanAmountSeries[6] < 100000);
  near(buffered.minLiquidationDistance, 1 - (2 / 3) / 0.95 ** 6, 1e-9);
  assert.equal(buffered.minLiquidationDistanceMonth, "2000-07");
  assert.ok(buffered.deleverageCount > 0 && buffered.deleverageCount < 24);
  assert.ok(buffered.totalDeleveraged > 0);

  const bidirectional = runBacktest(input(["FALL"], { ...margin, marginRebalanceMode: "bidirectional" }), prices);
  assert.equal(bidirectional.deleverageCount, 24);
});

test("liquidation metrics stay neutral without margin", () => {
  const result = runBacktest(input(["LONG"]), fixture);
  assert.equal(result.minLiquidationDistance, null);
  assert.ok(result.liquidationValueSeries.every(value => value === 0));
  assert.equal(result.liquidationValueSeries.length, result.months.length);
  assert.equal(result.liquidationDistanceSeries.length, result.months.length);
});
