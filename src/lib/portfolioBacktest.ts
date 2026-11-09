// Pure monthly backtest engine, shared by comparisons and optimization.
export interface AssetHistory {
  startDate: string;
  endDate: string;
  monthly: { date: string; close: number }[];
}

export type PricesMap = Record<string, AssetHistory>;

export interface BacktestPeriod {
  startMonth: string;
  endMonth: string;
}

export interface SimulationInput {
  // null means the compared portfolios have no overlapping history.
  comparisonPeriod?: BacktestPeriod | null;
  tickers: string[];
  weights: number[];
  initialInvestment: number;
  monthlyContribution: number;
  rebalance: "none" | "monthly" | "quarterly" | "annual" | "threshold5" | "bands5_25";
  // Margin loan (optional). When enabled, the portfolio is leveraged at start
  // by `marginLeverage` (e.g. 1.5 = 150 % gross exposure) and an annual
  // `marginLoanRate` interest is charged on the loan balance, either monthly
  // or yearly depending on `marginInterestFreq`.
  marginEnabled: boolean;
  marginLeverage: number;
  marginLoanRate: number;
  marginInterestFreq: "monthly" | "yearly";
  // Re-leverage: when true, each month the loan is adjusted to restore the
  // target leverage on the current equity. Direction is controlled by
  // marginRebalanceMode. "near-liquidation" borrows on gains like
  // "gains-only", and repays down to the target only once a further fall of
  // less than marginLiquidationBufferPct % would trigger liquidation.
  marginRebalance: boolean;
  marginRebalanceMode: "gains-only" | "bidirectional" | "near-liquidation";
  marginMaintenancePct: number;
  marginLiquidationBufferPct?: number; // default 10
  inflationPct: number;
  // Time window filter. "all" = full available data (default, no limit),
  // "lastN" = keep only the last N years of the available period,
  // "custom" = explicit [customStart, customEnd] month range (YYYY-MM).
  windowMode: "all" | "lastN" | "custom";
  yearsBack: number;
  customStart: string; // "" = no lower bound
  customEnd: string;   // "" = no upper bound
  // Stop monthly contributions after this many years (0 = never stop).
  contribStopYears: number;
}

export interface BacktestResult {
  startMonth: string;
  endMonth: string;
  limitingTicker: string;
  limitingTickerName: string;
  limitingEndTicker: string;
  limitingEndTickerName: string;
  months: string[];
  // Gross asset value held (equity + loan when margin is on).
  portfolioValue: number[];
  // Net equity = portfolioValue - loanAmount. Equal to portfolioValue when
  // margin is disabled.
  equityValue: number[];
  invested: number[];
  drawdown: number[];
  // Real (inflation-adjusted) equity values, same length as equityValue.
  // Each entry i is discounted from its month index: real_i = equity_i / (1+infl)^(i/12).
  equityValueReal: number[];
  investedReal: number[];
  finalValueReal: number;
  totalInvestedReal: number;
  inflationPct: number;
  realCagr: number;
  finalValue: number;
  totalInvested: number;
  cagr: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number;
  sortino: number;
  marginEnabled: boolean;
  marginLeverage: number;
  loanAmount: number;
  loanAmountSeries: number[];
  interestPaidSeries: number[];
  totalInterestPaid: number;
  liquidationMonth: string | null;
  // Gross asset value at which the broker liquidates, after each month's
  // re-leverage: loan / (1 - maintenance). 0 without a loan.
  liquidationValueSeries: number[];
  // Fall of gross assets (fraction) that would trigger liquidation, observed
  // at each month-end close before contributions and re-leverage.
  liquidationDistanceSeries: number[];
  // Closest observed call; null without margin.
  minLiquidationDistance: number | null;
  minLiquidationDistanceMonth: string | null;
  // Months in which re-leverage repaid part of the loan by selling assets.
  deleverageCount: number;
  totalDeleveraged: number;
}

export const RISK_FREE_RATE = 0.02;

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (mo === 12) return `${y + 1}-01`;
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function intersectPeriod(prices: PricesMap, tickers: string[], tickerNames: Record<string, string> = {}) {
  if (tickers.length === 0) {
    return {
      startMonth: "",
      endMonth: "",
      limitingTicker: "",
      limitingTickerName: "",
      limitingEndTicker: "",
      limitingEndTickerName: "",
      months: [] as string[],
      lookups: [] as Record<string, number>[],
    };
  }

  let maxStart = "";
  let minEnd = "";
  let limitingTicker = "";
  let limitingEndTicker = "";

  for (const t of tickers) {
    if (t === "CASH") continue;
    const hist = prices[t];
    if (!hist) continue;
    if (maxStart === "" || hist.startDate > maxStart) {
      maxStart = hist.startDate;
      limitingTicker = t;
    }
    if (minEnd === "" || hist.endDate < minEnd) {
      minEnd = hist.endDate;
      limitingEndTicker = t;
    }
  }

  const limitingTickerName =
    tickerNames[limitingTicker] ??
    limitingTicker;
  const limitingEndTickerName =
    tickerNames[limitingEndTicker] ??
    limitingEndTicker;

  const months: string[] = [];
  // CASH has constant value but still needs a finite calendar.
  if (!maxStart && tickers.every(ticker => ticker === "CASH")) {
    maxStart = prices.CASH?.startDate ?? "";
    minEnd = prices.CASH?.endDate ?? "";
  }
  let cur = maxStart;
  while (isValidMonth(cur) && isValidMonth(minEnd) && cur <= minEnd) {
    months.push(cur);
    cur = nextMonth(cur);
  }

  const lookups = tickers.map((t) => {
    if (t === "CASH") {
      return new Proxy({} as Record<string, number>, {
        get: () => 1,
        has: () => true,
      });
    }
    const map: Record<string, number> = {};
    const hist = prices[t];
    if (hist) {
      for (const pt of hist.monthly) {
        map[pt.date] = pt.close;
      }
    }
    return map;
  });

  return { startMonth: maxStart, endMonth: minEnd, limitingTicker, limitingTickerName, limitingEndTicker, limitingEndTickerName, months, lookups };
}

export function getComparisonPeriod(prices: PricesMap, selections: string[][]): BacktestPeriod | null {
  const tickers = [...new Set(selections.flat())];
  if (tickers.some(ticker => ticker !== "CASH" && !prices[ticker])) return null;
  const { startMonth, endMonth, months } = intersectPeriod(prices, tickers);
  return months.length >= 2 ? { startMonth, endMonth } : null;
}

export function selectBacktestMonths(allMonths: string[], input: SimulationInput): string[] {
  if (input.comparisonPeriod === null) return [];
  let months = allMonths;
  if (input.comparisonPeriod) {
    const { startMonth, endMonth } = input.comparisonPeriod;
    months = months.filter(month => month >= startMonth && month <= endMonth);
  }
  if (input.windowMode === "lastN" && input.yearsBack > 0) {
    // N years of returns require N*12 intervals plus their initial observation.
    months = months.slice(-Math.round(input.yearsBack * 12) - 1);
  } else if (input.windowMode === "custom") {
    const lo = isValidMonth(input.customStart) ? input.customStart : "";
    const hi = isValidMonth(input.customEnd) ? input.customEnd : "";
    const [start, end] = lo && hi && lo > hi ? [hi, lo] : [lo, hi];
    months = months.filter(month => (!start || month >= start) && (!end || month <= end));
  }
  return months;
}

export function runComparison(inputs: SimulationInput[], prices: PricesMap,
  tickerNames: Record<string, string> = {}): (BacktestResult | null)[] {
  const comparisonPeriod = getComparisonPeriod(prices, inputs.map(input => input.tickers));
  return inputs.map(input => runBacktest({ ...input, comparisonPeriod }, prices, tickerNames));
}

export function runBacktest(input: SimulationInput, allPrices: PricesMap, tickerNames: Record<string, string> = {}): BacktestResult | null {
  const {
    tickers,
    weights,
    initialInvestment,
    monthlyContribution,
    rebalance,
    marginEnabled,
    marginLeverage,
    marginLoanRate,
    marginInterestFreq,
    marginRebalance,
    marginRebalanceMode,
    marginMaintenancePct,
    marginLiquidationBufferPct = 10,
    inflationPct,
    contribStopYears,
  } = input;
  if (tickers.length === 0) return null;

  // Constant cash can span the comparison calendar, regardless of the dates
  // on the unrelated Yahoo CASH ticker used as a standalone calendar fallback.
  const periodPrices = input.comparisonPeriod && tickers.every(ticker => ticker === "CASH")
    ? { ...allPrices, CASH: { startDate: input.comparisonPeriod.startMonth, endDate: input.comparisonPeriod.endMonth, monthly: [] } }
    : allPrices;
  const { limitingTicker, limitingTickerName, limitingEndTicker, limitingEndTickerName, months: allMonths, lookups } = intersectPeriod(periodPrices, tickers, tickerNames);
  if (allMonths.length === 0) return null;

  const months = selectBacktestMonths(allMonths, input);
  // An empty requested period must not silently fall back to full history.
  if (months.length < 2) return null;
  const winStart = months[0];
  const winEnd = months[months.length - 1];

  const n = tickers.length;
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  // Auto-normalize: proportions matter, absolute sum does not
  const normDivisor = totalWeight > 0 ? totalWeight : 100;
  const wFrac = weights.map((w) => w / normDivisor);

  // Margin loan setup. Leverage L means total exposure = L * equity, so the
  // loan = (L - 1) * initialInvestment. Loan balance is held flat through the
  // simulation unless re-leverage is enabled; interest is deducted from
  // assets (reducing equity).
  const safeLeverage = marginEnabled ? Math.max(1, marginLeverage) : 1;
  let loanAmount = marginEnabled ? initialInvestment * (safeLeverage - 1) : 0;
  const initialLoan = loanAmount;
  const startingAssets = initialInvestment * safeLeverage;

  const assetValues: number[] = wFrac.map((wf) => startingAssets * wf);
  let totalInvested = initialInvestment;
  let peak = startingAssets - loanAmount;
  let totalInterestPaid = 0;
  let liquidationMonth: string | null = null;
  let deleverageCount = 0;
  let totalDeleveraged = 0;

  // Liquidation when equity <= maintenance * assets, i.e. when assets fall to
  // loan / (1 - maintenance).
  const maintFrac = marginMaintenancePct / 100;
  const liquidationValue = (loan: number) => marginEnabled && loan > 0 ? loan / (1 - maintFrac) : 0;
  const liquidationDistance = (assets: number, loan: number) =>
    assets > 0 ? 1 - liquidationValue(loan) / assets : 0;
  const bufferFrac = marginLiquidationBufferPct / 100;
  let minLiquidationDistance = marginEnabled ? liquidationDistance(startingAssets, loanAmount) : null;
  let minLiquidationDistanceMonth: string | null = marginEnabled ? months[0] : null;

  const portfolioValue: number[] = [startingAssets];
  const equityValue: number[] = [startingAssets - loanAmount];
  const loanAmountSeries: number[] = [loanAmount];
  const invested: number[] = [initialInvestment];
  const drawdown: number[] = [0];
  const interestPaidSeries: number[] = [0];
  const liquidationValueSeries: number[] = [liquidationValue(loanAmount)];
  const liquidationDistanceSeries: number[] = [liquidationDistance(startingAssets, loanAmount)];

  const monthlyReturns: number[] = [];

  for (let m = 1; m < months.length; m++) {
    const monthLabel = months[m];
    const prevMonthLabel = months[m - 1];

    for (let i = 0; i < n; i++) {
      const prevClose = lookups[i][prevMonthLabel];
      const curClose = lookups[i][monthLabel];
      if (prevClose == null || curClose == null) {
        continue;
      }
      const ret = curClose / prevClose;
      assetValues[i] *= ret;
    }

    // Margin interest. Charged on the outstanding loan balance.
    // Monthly: every month at rate/12. Yearly: on each 12-month anniversary.
    if (marginEnabled && loanAmount > 0) {
      let interest = 0;
      if (marginInterestFreq === "monthly") {
        interest = loanAmount * (marginLoanRate / 12);
      } else if (marginInterestFreq === "yearly" && m % 12 === 0) {
        interest = loanAmount * marginLoanRate;
      }
      if (interest > 0) {
        totalInterestPaid += interest;
        const beforeInterest = assetValues.reduce((s, v) => s + v, 0);
        if (beforeInterest > 0) {
          const scale = Math.max(0, (beforeInterest - interest) / beforeInterest);
          for (let i = 0; i < n; i++) assetValues[i] *= scale;
        }
      }
      interestPaidSeries.push(interest);
    } else {
      interestPaidSeries.push(0);
    }

    const valueAfterMarket = assetValues.reduce((s, v) => s + v, 0);
    const equityAfter = valueAfterMarket - loanAmount;
    const equityPrev = equityValue[m - 1];
    const marketReturn = equityPrev > 0 ? (equityAfter - equityPrev) / equityPrev : 0;
    monthlyReturns.push(marketReturn);

    const closeDistance = liquidationDistance(valueAfterMarket, loanAmount);
    if (minLiquidationDistance !== null && closeDistance < minLiquidationDistance) {
      minLiquidationDistance = closeDistance;
      minLiquidationDistanceMonth = monthLabel;
    }

    // Margin call / liquidation: equity falls below maintenance margin.
    // Broker sells everything, equity is 0 for the rest of the run.
    // Maintenance threshold: maintenancePct of total asset value. If equity < threshold,
    // liquidation triggers.
    const maintThreshold = marginEnabled ? marginMaintenancePct / 100 * valueAfterMarket : 0;
    if (marginEnabled && equityAfter <= maintThreshold && liquidationMonth === null) {
      liquidationMonth = monthLabel;
      loanAmount = 0;
      for (let k = m; k < months.length; k++) {
        portfolioValue.push(0);
        equityValue.push(0);
        loanAmountSeries.push(0);
        invested.push(totalInvested);
        drawdown.push(1);
        interestPaidSeries.push(0);
        liquidationValueSeries.push(0);
        liquidationDistanceSeries.push(0);
      }
      break;
    }

    const contribution = contribStopYears > 0 && m > contribStopYears * 12 ? 0 : monthlyContribution;
    for (let i = 0; i < n; i++) {
      assetValues[i] += contribution * wFrac[i];
    }
    totalInvested += contribution;

    const totalValue = assetValues.reduce((s, v) => s + v, 0);

    let shouldRebalance = false;
    if (rebalance === "monthly") {
      shouldRebalance = true;
    } else if (rebalance === "quarterly" && m % 3 === 0) {
      shouldRebalance = true;
    } else if (rebalance === "annual" && m % 12 === 0) {
      shouldRebalance = true;
    } else if (rebalance === "threshold5") {
      for (let i = 0; i < n; i++) {
        const target = wFrac[i];
        const actual = totalValue > 0 ? assetValues[i] / totalValue : 0;
        if (target > 0 && Math.abs(actual - target) > 0.05) {
          shouldRebalance = true;
          break;
        }
      }
    } else if (rebalance === "bands5_25") {
      for (let i = 0; i < n; i++) {
        const target = wFrac[i];
        const actual = totalValue > 0 ? assetValues[i] / totalValue : 0;
        const absDev = Math.abs(actual - target);
        const relDev = target > 0 ? absDev / target : 0;
        if (absDev > 0.05 || relDev > 0.25) {
          shouldRebalance = true;
          break;
        }
      }
    }

    if (shouldRebalance) {
      for (let i = 0; i < n; i++) {
        assetValues[i] = totalValue * wFrac[i];
      }
    }

    const postRebalanceTotal = assetValues.reduce((s, v) => s + v, 0);

    // Re-leverage: restore target leverage L on the current equity.
    // target_loan = (L - 1) * equity. delta = target - current.
    // gains-only: borrow more when delta > 0, ignore when delta < 0.
    // bidirectional: also repay (sell assets, shrink loan) when delta < 0.
    // near-liquidation: repay only within the buffer of the liquidation value.
    if (marginEnabled && marginRebalance && safeLeverage > 1) {
      const equity = postRebalanceTotal - loanAmount;
      if (equity > 0) {
        const targetLoan = (safeLeverage - 1) * equity;
        const delta = targetLoan - loanAmount;
        const shouldApply = marginRebalanceMode === "bidirectional" || delta > 0 ||
          (marginRebalanceMode === "near-liquidation" &&
            liquidationDistance(postRebalanceTotal, loanAmount) < bufferFrac);
        if (shouldApply && Math.abs(delta) > 0.01) {
          if (delta > 0) {
            for (let i = 0; i < n; i++) assetValues[i] += delta * wFrac[i];
            loanAmount += delta;
          } else {
            const repay = Math.min(-delta, postRebalanceTotal, loanAmount);
            if (repay > 0) {
              const scale = postRebalanceTotal > 0 ? (postRebalanceTotal - repay) / postRebalanceTotal : 0;
              for (let i = 0; i < n; i++) assetValues[i] *= scale;
              loanAmount -= repay;
              deleverageCount++;
              totalDeleveraged += repay;
            }
          }
        }
      }
    }

    const finalTotal = assetValues.reduce((s, v) => s + v, 0);
    const postEquity = finalTotal - loanAmount;
    portfolioValue.push(finalTotal);
    equityValue.push(postEquity);
    loanAmountSeries.push(loanAmount);
    liquidationValueSeries.push(liquidationValue(loanAmount));
    liquidationDistanceSeries.push(closeDistance);
    invested.push(totalInvested);
    peak = Math.max(peak, postEquity);
    const dd = peak > 0 ? (peak - postEquity) / peak : 0;
    drawdown.push(dd);
  }

  const finalValue = equityValue[equityValue.length - 1];
  const nMonths = months.length - 1;

  let cumProduct = 1;
  for (const r of monthlyReturns) cumProduct *= 1 + r;
  const cagr = nMonths > 0 ? Math.pow(cumProduct, 12 / nMonths) - 1 : 0;

  const meanMonthly = monthlyReturns.reduce((s, r) => s + r, 0) / Math.max(monthlyReturns.length, 1);
  const variance = monthlyReturns.reduce((s, r) => s + Math.pow(r - meanMonthly, 2), 0) / Math.max(monthlyReturns.length, 1);
  const monthlyStd = Math.sqrt(variance);
  const volatility = monthlyStd * Math.sqrt(12);

  const maxDrawdown = Math.max(...drawdown);

  const rfMonthly = RISK_FREE_RATE / 12;
  const sharpe = monthlyStd > 0 ? (meanMonthly - rfMonthly) / monthlyStd * Math.sqrt(12) : 0;

  const downsideReturns = monthlyReturns.filter((r) => r < rfMonthly);
  const downsideMean = downsideReturns.reduce((s, r) => s + r, 0) / Math.max(downsideReturns.length, 1);
  const downsideVariance = downsideReturns.reduce((s, r) => s + Math.pow(r - downsideMean, 2), 0) / Math.max(downsideReturns.length, 1);
  const downsideStd = Math.sqrt(downsideVariance);
  const sortino = downsideStd > 0 ? (meanMonthly - rfMonthly) / downsideStd * Math.sqrt(12) : 0;

  const inflFrac = inflationPct / 100;
  const equityValueReal = equityValue.map((v, i) => inflFrac > 0 ? v / Math.pow(1 + inflFrac, i / 12) : v);
  const investedReal = invested.map((v, i) => inflFrac > 0 ? v / Math.pow(1 + inflFrac, i / 12) : v);
  const finalValueReal = equityValueReal[equityValueReal.length - 1] ?? 0;
  const totalInvestedReal = investedReal[investedReal.length - 1] ?? 0;
  // Real CAGR = inflation-adjusted compound growth rate.
  const realCagr = inflFrac > 0 ? (1 + cagr) / (1 + inflFrac) - 1 : cagr;

  return {
    startMonth: winStart,
    endMonth: winEnd,
    limitingTicker,
    limitingTickerName,
    limitingEndTicker,
    limitingEndTickerName,
    months,
    portfolioValue,
    equityValue,
    invested,
    drawdown,
    equityValueReal,
    investedReal,
    finalValueReal,
    totalInvestedReal,
    inflationPct,
    realCagr,
    finalValue,
    totalInvested,
    cagr,
    volatility,
    maxDrawdown,
    sharpe,
    sortino,
    marginEnabled,
    marginLeverage: safeLeverage,
    loanAmount: initialLoan,
    loanAmountSeries,
    interestPaidSeries,
    totalInterestPaid,
    liquidationMonth,
    liquidationValueSeries,
    liquidationDistanceSeries,
    minLiquidationDistance,
    minLiquidationDistanceMonth,
    deleverageCount,
    totalDeleveraged,
  };
}
