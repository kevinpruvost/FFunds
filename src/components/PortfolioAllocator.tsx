"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Col,
  Grid,
  Metric,
  NumberInput,
  Select,
  SelectItem,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Text,
  Title,
} from "@tremor/react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import pricesData from "../data/prices.json";
import tickersConfig from "../data/tickers.config.json";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import { TRANSLATIONS } from "../i18n/translations";

/* ─────────────────────────── Types ─────────────────────────── */

interface TickerMeta {
  ticker: string;
  name: string;
  class: string;
  color: string;
}

interface AssetHistory {
  startDate: string;
  endDate: string;
  monthly: { date: string; close: number }[];
}

type PricesMap = Record<string, AssetHistory>;

interface CustomTicker {
  ticker: string;
  name: string;
  color: string;
  class: string;
  startDate: string;
  endDate: string;
  monthly: { date: string; close: number }[];
}

interface SimulationInput {
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
  // marginRebalanceMode.
  marginRebalance: boolean;
  marginRebalanceMode: "gains-only" | "bidirectional";
  marginMaintenancePct: number;
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

interface BacktestResult {
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
}

/* ─────────────────────────── Constants ─────────────────────────── */

const PRICES: PricesMap = pricesData as PricesMap;
const TICKERS: TickerMeta[] = tickersConfig as TickerMeta[];

const RISK_FREE_RATE = 0.02;

const CUSTOM_COLORS = [
  "#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee",
  "#a78bfa", "#f472b6", "#94a3b8", "#60a5fa", "#34d399",
];

const LS_KEY = "ffunds:custom-tickers";
const PA_COOKIE_NAME = "ffunds_pa_params";
const PA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

/*
 * Presets map ticker → weight (%).
 * When applied, any ticker in the preset is auto-selected if not already.
 */
const PRESETS: Record<string, Record<string, number>> = {
  golden: {
    "MSCI-WORLD-MOMENTUM": 20,
    "MSCI-WORLD-SMALL": 19,
    XLU: 10,
    TLT: 14,
    SHY: 6,
    KMLM: 15,
    GLD: 16,
  },
  "60/40": {
    SPY: 60,
    SHY: 40,
  },
  "all-weather": {
    SPY: 15,
    EFA: 15,
    TLT: 30,
    IEF: 10,
    GLD: 7.5,
    DBC: 7.5,
    KMLM: 15,
  },
  "equal-weight": {}, // computed dynamically
  aggressive: {
    SPY: 25,
    QQQ: 25,
    IWM: 15,
    EFA: 10,
    EEM: 10,
    "BTC-USD": 15,
  },
  "golden-2x": {
    "MSCI-WORLD-MOMENTUM": 20,
    "MSCI-WORLD-SMALL": 19,
    XLU: 10,
    TLT: 14,
    SHY: 6,
    KMLM: 15,
    GLD: 16,
  },
  "golden-3x": {
    "MSCI-WORLD-MOMENTUM": 20,
    "MSCI-WORLD-SMALL": 19,
    XLU: 10,
    TLT: 14,
    SHY: 6,
    KMLM: 15,
    GLD: 16,
  },
  "nasdaq-2x": {
    QLD: 100,
  },
};

const CLASS_KEYS: Record<string, string> = {
  "actions-us": "alloc.classLabel.actions-us",
  "actions-intl": "alloc.classLabel.actions-intl",
  "actions-em": "alloc.classLabel.actions-em",
  obligations: "alloc.classLabel.obligations",
  secteur: "alloc.classLabel.secteur",
  matieres: "alloc.classLabel.matieres",
  crypto: "alloc.classLabel.crypto",
  alternatif: "alloc.classLabel.alternatif",
  "indices-monde": "alloc.classLabel.indices-monde",
  cash: "alloc.classLabel.cash",
};

/* ─────────────────────────── Utilities ─────────────────────────── */

const eurFormatters: Record<string, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
};
const compactEurFormatters: Record<string, Intl.NumberFormat> = {
  fr: new Intl.NumberFormat("fr-FR", { notation: "compact", style: "currency", currency: "EUR", maximumFractionDigits: 1 }),
  en: new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "EUR", maximumFractionDigits: 1 }),
};

function formatEUR(n: number, lang: string = "fr"): string {
  return (eurFormatters[lang] ?? eurFormatters.fr).format(n);
}

function formatCompactEUR(n: number, lang: string = "fr"): string {
  return (compactEurFormatters[lang] ?? compactEurFormatters.fr).format(n);
}

function formatPct(n: number, digits = 1, lang: string = "fr"): string {
  const sep = lang === "en" ? "." : ",";
  return `${n.toFixed(digits).replace(".", sep)} %`;
}

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (mo === 12) return `${y + 1}-01`;
  return `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CUSTOM_COLORS[Math.abs(hash) % CUSTOM_COLORS.length];
}

function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const part = document.cookie.split(";").find((p) => p.trim().startsWith(`${name}=`));
  if (!part) return null;
  const raw = part.split("=").slice(1).join("=");
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/* ─────────────────────────── Engine ─────────────────────────── */

function intersectPeriod(prices: PricesMap, tickers: string[]) {
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
    TICKERS.find((t) => t.ticker === limitingTicker)?.name ??
    limitingTicker;
  const limitingEndTickerName =
    TICKERS.find((t) => t.ticker === limitingEndTicker)?.name ??
    limitingEndTicker;

  const months: string[] = [];
  let cur = maxStart;
  while (cur <= minEnd) {
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

function runBacktest(input: SimulationInput, allPrices: PricesMap): BacktestResult | null {
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
    inflationPct,
    windowMode,
    yearsBack,
    customStart,
    customEnd,
    contribStopYears,
  } = input;
  if (tickers.length === 0) return null;

  const { startMonth, endMonth, limitingTicker, limitingTickerName, limitingEndTicker, limitingEndTickerName, months: allMonths, lookups } = intersectPeriod(allPrices, tickers);
  if (allMonths.length === 0) return null;

  // Apply time window filter on top of the ticker-intersected period.
  // "all": no filter. "lastN": keep final N*12 months. "custom": clamp to
  // [customStart, customEnd] (empty string = no bound on that side).
  let months = allMonths;
  let winStart = startMonth;
  let winEnd = endMonth;
  if (windowMode === "lastN" && yearsBack > 0) {
    const cutoffIdx = Math.max(0, allMonths.length - yearsBack * 12);
    months = allMonths.slice(cutoffIdx);
    winStart = months[0] ?? startMonth;
  } else if (windowMode === "custom") {
    const lo = customStart || "";
    const hi = customEnd || "";
    months = allMonths.filter((m) => (lo === "" || m >= lo) && (hi === "" || m <= hi));
    if (months.length === 0) return null;
    winStart = months[0];
    winEnd = months[months.length - 1];
  }

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

  const portfolioValue: number[] = [startingAssets];
  const equityValue: number[] = [startingAssets - loanAmount];
  const loanAmountSeries: number[] = [loanAmount];
  const invested: number[] = [initialInvestment];
  const drawdown: number[] = [0];
  const interestPaidSeries: number[] = [0];

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
    if (marginEnabled && marginRebalance && safeLeverage > 1) {
      const equity = postRebalanceTotal - loanAmount;
      if (equity > 0) {
        const targetLoan = (safeLeverage - 1) * equity;
        const delta = targetLoan - loanAmount;
        const shouldApply = marginRebalanceMode === "bidirectional" || delta > 0;
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
  };
}

/* ─────────────────────────── Component ─────────────────────────── */

type OptimizeGoal = "cagr" | "sharpe" | "minVol";

// Sample a random weight vector of length n that sums to 1 using Dirichlet-like
// perturbation around a center. `concentration` controls how spread the samples are:
// low = close to center, high = more uniform.
function sampleDirichlet(n: number, center: number[], concentration: number): number[] {
  const alpha = center.map((c) => Math.max(0.01, c * concentration));
  const samples = alpha.map((a) => {
    // Gamma sample via Marsaglia-Tsang
    if (a < 1) {
      // Boost for shape < 1
      const u = Math.random();
      const e = Math.random();
      return Math.pow(u, 1 / a) * (-Math.log(e));
    }
    const d = a - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    let x: number, v: number;
    for (;;) {
      let z: number;
      do {
        const r1 = Math.random();
        const r2 = Math.random();
        z = Math.sqrt(-2 * Math.log(r1)) * Math.cos(2 * Math.PI * r2);
      } while (z <= -c);
      v = 1 + c * z;
      x = d * v * v * v;
      const r3 = Math.random();
      const u2 = 0.5 * r3 * r3;
      if (u2 < 1 - 0.0331 * z * z * z * z || Math.log(u2) < 0.5 * z * z + d * (1 - v + Math.log(v))) {
        break;
      }
    }
    return x;
  });
  const sum = samples.reduce((s, v) => s + v, 0);
  return samples.map((v) => v / sum);
}

// Optimizer: searches weight+leverage space to maximize (or minimize) a metric.
// Uses random sampling + coordinate refinement. Returns best weights and leverage.
function optimizePortfolio(
  base: SimulationInput,
  allPrices: PricesMap,
  goal: OptimizeGoal,
  onProgress?: (p: number) => void
): { weights: number[]; marginEnabled: boolean; marginLeverage: number } | null {
  const n = base.tickers.length;
  if (n === 0) return null;
  const leverageOptions = [1, 1.5, 2, 2.5, 3];
  const evalCandidate = (
    w: number[],
    leverage: number
  ): { metric: number; valid: boolean } => {
    const input: SimulationInput = {
      ...base,
      weights: w,
      marginEnabled: leverage > 1,
      marginLeverage: leverage,
      marginLoanRate: base.marginLoanRate,
      marginRebalance: leverage > 1 ? base.marginRebalance : false,
      marginRebalanceMode: base.marginRebalanceMode,
      marginMaintenancePct: base.marginMaintenancePct,
    };
    const res = runBacktest(input, allPrices);
    if (!res || res.liquidationMonth || res.cagr <= -0.99) return { metric: -Infinity, valid: false };
    let metric: number;
    switch (goal) {
      case "cagr":
        metric = res.cagr;
        break;
      case "sharpe":
        metric = res.sharpe;
        break;
      case "minVol":
        metric = -res.volatility; // minimize = maximize negative
        break;
    }
    return { metric, valid: true };
  };

  // Phase 1: random search around current weights
  const center = base.weights.length === n ? base.weights.map((w) => w / 100) : Array(n).fill(1 / n);
  const N_RANDOM = 60;
  let bestMetric = -Infinity;
  let bestW = center.slice();
  let bestLev = 1;
  for (let i = 0; i < N_RANDOM; i++) {
    for (const lev of leverageOptions) {
      const conc = 5 + i * 0.3;
      const w = sampleDirichlet(n, center, conc);
      const { metric, valid } = evalCandidate(w, lev);
      if (valid && metric > bestMetric) {
        bestMetric = metric;
        bestW = w.slice();
        bestLev = lev;
      }
    }
    if (onProgress && i % 10 === 0) onProgress(i / N_RANDOM * 0.5);
  }

  // Phase 2: coordinate refinement on the best candidate
  for (let round = 0; round < 3; round++) {
    for (const lev of leverageOptions) {
      for (let i = 0; i < n; i++) {
        for (let delta of [0.05, -0.05, 0.1, -0.1, 0.15, -0.15]) {
          const w = bestW.slice();
          w[i] = Math.max(0, w[i] + delta);
          const sum = w.reduce((s, v) => s + v, 0);
          if (sum <= 0) continue;
          for (let k = 0; k < n; k++) w[k] /= sum;
          const { metric, valid } = evalCandidate(w, lev);
          if (valid && metric > bestMetric) {
            bestMetric = metric;
            bestW = w.slice();
            bestLev = lev;
          }
        }
      }
    }
    if (onProgress) onProgress(0.5 + (round + 1) / 3 * 0.5);
  }
  if (onProgress) onProgress(1);

  return { weights: bestW.map((v) => Math.round(v * 10000) / 100), marginEnabled: bestLev > 1, marginLeverage: bestLev };
}

// Module-scope helpers (defined OUTSIDE PortfolioAllocatorInner so React doesn't
// remount the subtree on each state change — causes NumberInput defocus bug).

// Text-based numeric input: local string state, commit on blur/Enter.
// Avoids Tremor NumberInput clamp-on-keystroke that prevents clearing the field.
const NumberInputField = ({
  value,
  onCommit,
  min,
  max,
  step = 1,
  className = "",
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) => {
  const [local, setLocal] = useState(value === 0 ? "" : String(value));
  useEffect(() => {
    setLocal(value === 0 ? "" : String(value));
  }, [value]);
  const commit = () => {
    if (local === "") {
      onCommit(0);
      return;
    }
    let v = parseFloat(local);
    if (isNaN(v)) v = value;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onCommit(v);
    setLocal(v === 0 ? "" : String(v));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      className={`w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 ${className}`}
    />
  );
};

const LabelWithHelp = ({ labelKey, helpKey, children }: { labelKey: string; helpKey: string; children?: React.ReactNode }) => {
  const { t } = useI18n();
  return (
    <div className="group relative inline-block w-full">
      <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1 cursor-help min-h-[1.25rem] leading-tight whitespace-nowrap truncate">{t(labelKey)}</Text>
      {children}
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
        {t(helpKey)}
      </div>
    </div>
  );
};

const MetricCard = ({
  labelKey,
  helpKey,
  children,
  cardClass = "",
  metricClass = "",
}: {
  labelKey: string;
  helpKey: string;
  children: React.ReactNode;
  cardClass?: string;
  metricClass?: string;
}) => {
  const { t } = useI18n();
  return (
    <Col>
      <div className="group relative">
        <Card className={`bg-slate-800/50 border-slate-700/50 p-3 cursor-help ${cardClass}`}>
          <Text className="text-tremor-content dark:text-slate-400 text-xs">{t(labelKey)}</Text>
          <Metric className={`text-lg ${metricClass}`}>{children}</Metric>
        </Card>
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
          {t(helpKey)}
        </div>
      </div>
    </Col>
  );
};

function PortfolioAllocatorInner(): JSX.Element {
  const { lang, t } = useI18n();
  const [selectedTickers, setSelectedTickers] = useState<string[]>(["SPY", "SHY"]);
  const [weights, setWeights] = useState<Record<string, number>>({ SPY: 60, SHY: 40 });
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [autoNormalize, setAutoNormalize] = useState<boolean>(false);

  const [initialInvestment, setInitialInvestment] = useState<number>(100000);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(500);
  const [rebalance, setRebalance] = useState<SimulationInput["rebalance"]>("annual");

  const [marginEnabled, setMarginEnabled] = useState<boolean>(false);
  const [marginLeverage, setMarginLeverage] = useState<number>(1.5);
  const [marginLoanRatePct, setMarginLoanRatePct] = useState<number>(5);
  const [marginInterestFreq, setMarginInterestFreq] = useState<SimulationInput["marginInterestFreq"]>("monthly");
  const [marginRebalance, setMarginRebalance] = useState<boolean>(true);
  const [marginRebalanceMode, setMarginRebalanceMode] = useState<SimulationInput["marginRebalanceMode"]>("gains-only");
  const [marginMaintenancePct, setMarginMaintenancePct] = useState<number>(25);

  const [inflationPct, setInflationPct] = useState<number>(2.5);

  const [windowMode, setWindowMode] = useState<SimulationInput["windowMode"]>("all");
  const [yearsBack, setYearsBack] = useState<number>(10);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [contribStopYears, setContribStopYears] = useState<number>(0);

  const [optimizing, setOptimizing] = useState<OptimizeGoal | null>(null);
  const [optProgress, setOptProgress] = useState<number>(0);

  // Custom tickers state
  const [customTickers, setCustomTickers] = useState<Record<string, CustomTicker>>({});
  const [customInput, setCustomInput] = useState<string>("");
  const [customLoading, setCustomLoading] = useState<boolean>(false);
  const [customError, setCustomError] = useState<string>("");

  // Filter state
  const [filterText, setFilterText] = useState<string>("");

  // Hydrate custom tickers from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, CustomTicker>;
        setCustomTickers(parsed);
      }
    } catch {
      // ignore corrupt localStorage
    }
  }, []);

  // Persist custom tickers to localStorage
  useEffect(() => {
    if (Object.keys(customTickers).length > 0) {
      localStorage.setItem(LS_KEY, JSON.stringify(customTickers));
    }
  }, [customTickers]);

  // Load persisted portfolio params from cookie on mount
  useEffect(() => {
    try {
      const raw = readCookie(PA_COOKIE_NAME);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<{
        selectedTickers: string[];
        weights: Record<string, number>;
        initialInvestment: number;
        monthlyContribution: number;
        rebalance: SimulationInput["rebalance"];
        marginEnabled: boolean;
        marginLeverage: number;
        marginLoanRatePct: number;
        marginInterestFreq: SimulationInput["marginInterestFreq"];
        marginRebalance: boolean;
        marginRebalanceMode: SimulationInput["marginRebalanceMode"];
        marginMaintenancePct: number;
        inflationPct: number;
        windowMode: SimulationInput["windowMode"];
        yearsBack: number;
        customStart: string;
        customEnd: string;
        contribStopYears: number;
      }>;
      if (Array.isArray(data.selectedTickers) && data.selectedTickers.length > 0) {
        setSelectedTickers(data.selectedTickers);
      }
      if (data.weights && typeof data.weights === "object") {
        setWeights((prev) => ({ ...prev, ...data.weights! }));
      }
      if (typeof data.initialInvestment === "number") setInitialInvestment(data.initialInvestment);
      if (typeof data.monthlyContribution === "number") setMonthlyContribution(data.monthlyContribution);
      if (data.rebalance) setRebalance(data.rebalance);
      if (typeof data.marginEnabled === "boolean") setMarginEnabled(data.marginEnabled);
      if (typeof data.marginLeverage === "number") setMarginLeverage(data.marginLeverage);
      if (typeof data.marginLoanRatePct === "number") setMarginLoanRatePct(data.marginLoanRatePct);
      if (data.marginInterestFreq) setMarginInterestFreq(data.marginInterestFreq);
      if (typeof data.marginRebalance === "boolean") setMarginRebalance(data.marginRebalance);
      if (data.marginRebalanceMode) setMarginRebalanceMode(data.marginRebalanceMode);
      if (typeof data.marginMaintenancePct === "number") setMarginMaintenancePct(data.marginMaintenancePct);
      if (typeof data.inflationPct === "number") setInflationPct(data.inflationPct);
      if (data.windowMode === "all" || data.windowMode === "lastN" || data.windowMode === "custom") setWindowMode(data.windowMode);
      if (typeof data.yearsBack === "number") setYearsBack(data.yearsBack);
      if (typeof data.customStart === "string") setCustomStart(data.customStart);
      if (typeof data.customEnd === "string") setCustomEnd(data.customEnd);
      if (typeof data.contribStopYears === "number") setContribStopYears(data.contribStopYears);
    } catch {
      // ignore corrupt cookie
    }
  }, []);

  // Persist portfolio params to cookie
  useEffect(() => {
    const data = {
      selectedTickers,
      weights,
      initialInvestment,
      monthlyContribution,
      rebalance,
      marginEnabled,
      marginLeverage,
      marginLoanRatePct,
      marginInterestFreq,
      marginRebalance,
      marginRebalanceMode,
      marginMaintenancePct,
      inflationPct,
      windowMode,
      yearsBack,
      customStart,
      customEnd,
      contribStopYears,
    };
    const value = encodeURIComponent(JSON.stringify(data));
    document.cookie = `${PA_COOKIE_NAME}=${value}; max-age=${PA_COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
  }, [
    selectedTickers,
    weights,
    initialInvestment,
    monthlyContribution,
    rebalance,
    marginEnabled,
    marginLeverage,
    marginLoanRatePct,
    marginInterestFreq,
    marginRebalance,
    marginRebalanceMode,
    inflationPct,
    windowMode,
    yearsBack,
    customStart,
    customEnd,
    contribStopYears,
  ]);

  // Build merged prices map (static + custom)
  const allPrices = useMemo<PricesMap>(() => {
    const merged: PricesMap = { ...PRICES };
    for (const [ticker, ct] of Object.entries(customTickers)) {
      merged[ticker] = {
        startDate: ct.startDate,
        endDate: ct.endDate,
        monthly: ct.monthly,
      };
    }
    return merged;
  }, [customTickers]);

  // Build merged ticker metadata list
  const allTickers = useMemo<TickerMeta[]>(() => {
    const curated = TICKERS;
    const custom = Object.values(customTickers).map((ct) => ({
      ticker: ct.ticker,
      name: ct.name,
      class: ct.class,
      color: ct.color,
    }));
    return [...curated, ...custom];
  }, [customTickers]);

  const weightArray = useMemo(() => selectedTickers.map((t) => weights[t] ?? 0), [selectedTickers, weights]);
  const totalWeight = useMemo(() => weightArray.reduce((s, w) => s + w, 0), [weightArray]);
  const isBalanced = Math.abs(totalWeight - 100) < 0.01;

  const simulationInput = useMemo<SimulationInput>(
    () => ({
      tickers: selectedTickers,
      weights: weightArray,
      initialInvestment,
      monthlyContribution,
      rebalance,
      marginEnabled,
      marginLeverage,
      marginLoanRate: marginLoanRatePct / 100,
      marginInterestFreq,
      marginRebalance,
      marginRebalanceMode,
      marginMaintenancePct,
      inflationPct,
      windowMode,
      yearsBack,
      customStart,
      customEnd,
      contribStopYears,
    }),
    [selectedTickers, weightArray, initialInvestment, monthlyContribution, rebalance, marginEnabled, marginLeverage, marginLoanRatePct, marginInterestFreq, marginRebalance,     marginRebalanceMode,
    marginMaintenancePct,
    inflationPct,
    windowMode, yearsBack, customStart, customEnd, contribStopYears]
  );

  const deferredInput = useDeferredValue(simulationInput);
  const isPending = deferredInput !== simulationInput;

  const loanPreview = marginEnabled ? initialInvestment * (Math.max(1, marginLeverage) - 1) : 0;

  // Always run backtest — weights are auto-normalized inside runBacktest
  const result = useMemo<BacktestResult | null>(() => {
    if (selectedTickers.length === 0) return null;
    return runBacktest(deferredInput, allPrices);
  }, [deferredInput, selectedTickers.length, allPrices]);

  const toggleTicker = useCallback((ticker: string) => {
    setSelectedTickers((prev) => {
      const exists = prev.includes(ticker);
      if (exists) {
        const next = prev.filter((t) => t !== ticker);
        setWeights((w) => {
          const nw = { ...w };
          delete nw[ticker];
          return nw;
        });
        setLocked((l) => {
          const nl = { ...l };
          delete nl[ticker];
          return nl;
        });
        return next;
      }
      const next = [...prev, ticker];
      setWeights((w) => ({ ...w, [ticker]: 0 }));
      return next;
    });
  }, []);

  const handleWeightChange = useCallback(
    (ticker: string, value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      setWeights((prev) => {
        if (autoNormalize) {
          const next = { ...prev, [ticker]: clamped };
          const tickers = selectedTickers;
          const lockedSum = tickers.reduce((s, t) => s + (locked[t] ? (next[t] ?? 0) : 0), 0);
          const unlocked = tickers.filter((t) => !locked[t]);
          const targetUnlocked = 100 - lockedSum;
          const currentUnlocked = unlocked.reduce((s, t) => s + (next[t] ?? 0), 0);

          if (unlocked.length === 0) return next;

          if (currentUnlocked === 0) {
            const share = targetUnlocked / unlocked.length;
            for (const t of unlocked) next[t] = share;
          } else {
            const scale = targetUnlocked / currentUnlocked;
            for (const t of unlocked) next[t] = (next[t] ?? 0) * scale;
          }

          const rounded: Record<string, number> = {};
          for (const t of tickers) {
            rounded[t] = Math.round((next[t] ?? 0) * 100) / 100;
          }
          return rounded;
        }
        return { ...prev, [ticker]: clamped };
      });
    },
    [autoNormalize, selectedTickers, locked]
  );

  const toggleLock = useCallback((ticker: string) => {
    setLocked((prev) => ({ ...prev, [ticker]: !prev[ticker] }));
  }, []);

  const applyPreset = useCallback((presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    if (presetKey === "equal-weight") {
      const tickers = selectedTickers.length > 0 ? selectedTickers : Object.keys(PRESETS["golden"]);
      const share = 100 / tickers.length;
      const newWeights: Record<string, number> = {};
      for (const t of tickers) newWeights[t] = Math.round(share * 100) / 100;
      const sum = Object.values(newWeights).reduce((s, w) => s + w, 0);
      if (sum !== 100 && tickers.length > 0) {
        newWeights[tickers[0]] += 100 - sum;
      }
      setSelectedTickers(tickers);
      setWeights(newWeights);
      return;
    }

    const tickers = Object.keys(preset);
    setSelectedTickers(tickers);
    setWeights({ ...preset });

    // Leverage presets: enable margin with appropriate leverage and 4% loan rate.
    if (presetKey === "golden-2x") {
      setMarginEnabled(true);
      setMarginLeverage(2);
      setMarginLoanRatePct(4);
    } else if (presetKey === "golden-3x") {
      setMarginEnabled(true);
      setMarginLeverage(3);
      setMarginLoanRatePct(4);
    } else if (presetKey === "nasdaq-2x") {
      setMarginEnabled(false);
      setMarginLeverage(1);
      setMarginLoanRatePct(5);
    }
  }, [selectedTickers]);

  const runOptimizer = useCallback(
    (goal: OptimizeGoal) => {
      if (selectedTickers.length < 2) return;
      setOptimizing(goal);
      setOptProgress(0);
      // Defer so the spinner shows. runBacktest is synchronous and heavy;
      // we chunk the work via setTimeout between phases.
      setTimeout(() => {
        const res = optimizePortfolio(simulationInput, allPrices, goal, (p) => setOptProgress(p));
        if (res) {
          const newWeights: Record<string, number> = {};
          for (let i = 0; i < selectedTickers.length; i++) {
            newWeights[selectedTickers[i]] = res.weights[i] ?? 0;
          }
          setWeights(newWeights);
          setMarginEnabled(res.marginEnabled);
          setMarginLeverage(res.marginLeverage);
          if (res.marginEnabled) {
            setMarginRebalance(true);
            setMarginRebalanceMode("bidirectional");
          }
        }
        setOptimizing(null);
        setOptProgress(0);
      }, 50);
    },
    [selectedTickers, simulationInput, allPrices]
  );

  const fetchCustomTicker = useCallback(async (ticker: string) => {
    setCustomLoading(true);
    setCustomError("");
    try {
      const period2 = Math.floor(Date.now() / 1000);
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=946684800&period2=${period2}&interval=1mo&events=div,splits`;
      const encoded = encodeURIComponent(yahooUrl);

      // Public CORS proxies for Yahoo Finance. Yahoo has no browser CORS, so we
      // need a relay. We try several in order — these public proxies are flaky
      // (rate-limited / 5xx intermittently), so the chain gives us redundancy.
      // `/get` returns { contents: "<json-string>" } — needs double parse.
      // `/raw` returns the upstream body directly — preferred when reachable.
      const proxyCandidates = [
        `https://api.allorigins.win/raw?url=${encoded}`,
        `https://api.allorigins.win/get?url=${encoded}`,
        `https://api.codetabs.com/v1/proxy/?quest=${encoded}`,
      ];

      let json: unknown;
      let lastErr: unknown;
      for (const url of proxyCandidates) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await fetch(url, {
              headers: { Accept: "application/json, text/plain, */*" },
            });
            if (!res.ok) {
              lastErr = new Error(`HTTP ${res.status}`);
              if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
              continue;
            }
            const text = await res.text();
            // allorigins `/get` shape: { "contents": "<stringified body>" }
            let body = text;
            try {
              const outer = JSON.parse(text);
              if (outer && typeof outer === "object" && typeof (outer as { contents?: unknown }).contents === "string") {
                body = (outer as { contents: string }).contents;
              }
            } catch {
              // text was not the `/get` shape — that's fine, body stays as text
            }
            json = JSON.parse(body);
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
          }
        }
        if (json !== undefined) break;
      }
      if (json === undefined) {
        throw lastErr instanceof Error ? lastErr : new Error("alloc.custom.fetchFailAll");
      }

      const chart = (json as { chart?: { result?: unknown[]; error?: { description?: string } } }).chart;
      if (chart?.error) {
        throw new Error(chart.error.description || "Yahoo Finance error");
      }

      const result = chart?.result?.[0] as {
        timestamp?: number[];
        indicators?: {
          quote?: { close?: (number | null)[] }[];
          adjclose?: { adjclose?: (number | null)[] }[];
        };
      } | undefined;
      if (!result) throw new Error("alloc.custom.noData");

      const timestamps: number[] = result.timestamp || [];
      const quote: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      const adjclose: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose || [];

      const monthly: { date: string; close: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const close = adjclose[i] ?? quote[i];
        if (close == null || Number.isNaN(close)) continue;
        monthly.push({ date: formatDate(timestamps[i]), close: Number(close) });
      }

      if (monthly.length === 0) throw new Error("alloc.custom.noValidPrices");

      const ct: CustomTicker = {
        ticker,
        name: ticker,
        color: hashColor(ticker),
        class: "custom",
        startDate: monthly[0].date,
        endDate: monthly[monthly.length - 1].date,
        monthly,
      };

      setCustomTickers((prev) => {
        const next = { ...prev, [ticker]: ct };
        try { localStorage.setItem("ffunds:custom-tickers", JSON.stringify(next)); } catch { /* ignore quota errors */ }
        return next;
      });
      setCustomInput("");
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : "alloc.custom.unknownError");
    } finally {
      setCustomLoading(false);
    }
  }, []);

  const removeCustomTicker = useCallback((ticker: string) => {
    setCustomTickers((prev) => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
    setSelectedTickers((prev) => prev.filter((t) => t !== ticker));
    setWeights((w) => {
      const nw = { ...w };
      delete nw[ticker];
      return nw;
    });
    setLocked((l) => {
      const nl = { ...l };
      delete nl[ticker];
      return nl;
    });
  }, []);

  const refreshCustomTicker = useCallback(async (ticker: string) => {
    await fetchCustomTicker(ticker);
  }, [fetchCustomTicker]);

  const handleAddCustom = useCallback(() => {
    const raw = customInput.trim().toUpperCase();
    if (!raw) return;
    if (!/^[A-Z^][A-Z0-9.\-]+$/.test(raw)) {
      setCustomError("alloc.custom.badFormat");
      return;
    }
    if (allTickers.some((t) => t.ticker === raw)) {
      setCustomError(`alloc.custom.alreadyExists:${raw}`);
      return;
    }
    fetchCustomTicker(raw);
  }, [customInput, allTickers, fetchCustomTicker]);

  const portfolioChartData = useMemo(() => {
    if (!result) return [];
    return result.portfolioValue.map((v, i) => ({
      month: result.months[i],
      value: v,
      equity: result.equityValue[i],
      equityReal: result.equityValueReal[i],
      invested: result.invested[i],
      investedReal: result.investedReal[i],
      loan: result.loanAmountSeries[i],
    }));
  }, [result]);

  const drawdownChartData = useMemo(() => {
    if (!result) return [];
    return result.drawdown.map((d, i) => ({
      month: result.months[i],
      drawdown: -(d * 100),
    }));
  }, [result]);

  const allocationChartData = useMemo(() => {
    return selectedTickers.map((t) => {
      const meta = allTickers.find((x) => x.ticker === t);
      return {
        asset: meta?.name ?? t,
        allocation: weights[t] ?? 0,
        color: meta?.color ?? "#94a3b8",
      };
    });
  }, [selectedTickers, weights, allTickers]);

  const correlationMatrix = useMemo(() => {
    const tickers = selectedTickers;
    if (tickers.length < 2) return null;

    const { months: allMonths, lookups } = intersectPeriod(allPrices, tickers);
    if (allMonths.length < 2) return null;

    // Per-ticker monthly returns
    const returns: Record<string, number[]> = {};
    tickers.forEach((ticker, i) => {
      const lookup = lookups[i];
      const r: number[] = [];
      for (let m = 1; m < allMonths.length; m++) {
        const prev = lookup[allMonths[m - 1]];
        const cur = lookup[allMonths[m]];
        if (prev && cur && prev > 0) {
          r.push(cur / prev - 1);
        }
      }
      returns[ticker] = r;
    });

    // Pearson correlation
    const corr = (a: number[], b: number[]): number => {
      const n = Math.min(a.length, b.length);
      if (n < 2) return 0;
      let sa = 0, sb = 0, sab = 0, sa2 = 0, sb2 = 0;
      for (let i = 0; i < n; i++) {
        sa += a[i]; sb += b[i]; sab += a[i] * b[i];
        sa2 += a[i] * a[i]; sb2 += b[i] * b[i];
      }
      const num = n * sab - sa * sb;
      const den = Math.sqrt((n * sa2 - sa * sa) * (n * sb2 - sb * sb));
      return den === 0 ? 0 : num / den;
    };

    return tickers.map((t1) =>
      tickers.map((t2) => (t1 === t2 ? 1 : corr(returns[t1] ?? [], returns[t2] ?? [])))
    );
  }, [selectedTickers, allPrices]);

  const yearlyChartData = useMemo(() => {
    if (!result) return [];
    const inflFrac = result.inflationPct / 100;
    const buckets: Record<string, {
      year: string;
      invested: number;
      investedReal: number;
      equityStart: number;
      equityEnd: number;
      equityEndReal: number;
      interest: number;
      gain: number;
      gainReal: number;
      firstIdx: number;
    }> = {};
    for (let i = 0; i < result.months.length; i++) {
      const y = result.months[i].slice(0, 4);
      if (!buckets[y]) {
        buckets[y] = {
          year: y,
          invested: 0,
          investedReal: 0,
          equityStart: i > 0 ? result.equityValue[i - 1] : result.equityValue[i],
          equityEnd: result.equityValue[i],
          equityEndReal: result.equityValueReal[i],
          interest: 0,
          gain: 0,
          gainReal: 0,
          firstIdx: i,
        };
      }
      const b = buckets[y];
      b.equityEnd = result.equityValue[i];
      b.equityEndReal = result.equityValueReal[i];
      b.interest += result.interestPaidSeries[i] ?? 0;
      if (i > 0) {
        b.invested += result.invested[i] - result.invested[i - 1];
        b.investedReal += (result.investedReal[i] ?? 0) - (result.investedReal[i - 1] ?? 0);
      }
    }
    const years = Object.values(buckets).sort((a, b) => a.year.localeCompare(b.year));
    for (const y of years) {
      y.gain = y.equityEnd - y.equityStart - y.invested;
      y.gainReal = y.equityEndReal - y.equityStart - y.investedReal;
    }
    return years;
  }, [result]);

  // ── Contribution impact per year ──
  // investedYear: total contributions that year. share = investedYear / equityEnd,
  // i.e. what % of the year-end portfolio value came from that year's contributions.
  const contributionImpactData = useMemo(() => {
    if (!result) return [];
    const buckets: Record<string, { year: string; investedYear: number; equityEnd: number }> = {};
    for (let i = 0; i < result.months.length; i++) {
      const y = result.months[i].slice(0, 4);
      if (!buckets[y]) {
        buckets[y] = { year: y, investedYear: 0, equityEnd: result.equityValue[i] };
      }
      const b = buckets[y];
      b.equityEnd = result.equityValue[i];
      if (i > 0) {
        b.investedYear += result.invested[i] - result.invested[i - 1];
      }
    }
    return Object.values(buckets).sort((a, b) => a.year.localeCompare(b.year));
  }, [result]);

  // Group tickers by class for the picker
  const groupedTickers = useMemo(() => {
    const groups: Record<string, TickerMeta[]> = {};
    for (const t of allTickers) {
      if (!groups[t.class]) groups[t.class] = [];
      groups[t.class].push(t);
    }
    return groups;
  }, [allTickers]);

  const filteredGroups = useMemo(() => {
    const term = filterText.toLowerCase().trim();
    if (!term) return groupedTickers;
    const filtered: Record<string, TickerMeta[]> = {};
    for (const [cls, list] of Object.entries(groupedTickers)) {
      const matches = list.filter(
        (t) => {
          const frLabel = TRANSLATIONS.fr[`alloc.classLabel.${t.class}`] ?? t.class;
          const enLabel = TRANSLATIONS.en[`alloc.classLabel.${t.class}`] ?? t.class;
          return (
            t.ticker.toLowerCase().includes(term) ||
            t.name.toLowerCase().includes(term) ||
            frLabel.toLowerCase().includes(term) ||
            enLabel.toLowerCase().includes(term)
          );
        }
      );
      if (matches.length > 0) filtered[cls] = matches;
    }
    return filtered;
  }, [groupedTickers, filterText]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="rounded-tremor-default border border-slate-700 bg-slate-900/95 p-2 shadow-tremor-card">
        <Text className="text-tremor-content-strong dark:text-slate-100 text-xs font-semibold">
          {label}
        </Text>
        {payload.map((p, i) => (
          <div key={i} className="text-tremor-content dark:text-slate-400 text-xs">
            {p.dataKey === "value" && `${t("alloc.chart.value")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "equity" && `${t("alloc.chart.equity")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "equityReal" && `${t("alloc.chart.equityLabel")} (${t("alloc.real.suffix")}): ${formatEUR(p.value, lang)}`}
            {p.dataKey === "invested" && `${t("alloc.chart.invested")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "investedReal" && `${t("alloc.chart.invested")} (${t("alloc.real.suffix")}): ${formatEUR(p.value, lang)}`}
            {p.dataKey === "loan" && `${t("alloc.chart.loan")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "drawdown" && `${t("alloc.chart.drawdownLabel")}: ${p.value.toFixed(1)} %`}
            {p.dataKey === "allocation" && `${p.value.toFixed(1)} %`}
            {p.dataKey === "gain" && `${t("alloc.chart.gain")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "gainReal" && `${t("alloc.chart.gain")} (${t("alloc.real.suffix")}): ${formatEUR(p.value, lang)}`}
            {p.dataKey === "interest" && `${t("alloc.metrics.interestPaid")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "equityEnd" && `${t("alloc.metrics.finalValue")}: ${formatEUR(p.value, lang)}`}
            {p.dataKey === "equityEndReal" && `${t("alloc.metrics.finalValueReal")}: ${formatEUR(p.value, lang)}`}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="dark space-y-6">
      {/* Info banners */}
      {!isBalanced && selectedTickers.length > 0 && (
        <Callout title={t("alloc.callout.unbalanced.title")} color="amber" className="border-amber-800 bg-amber-950/40">
          <Text className="text-amber-300">
            {t("alloc.callout.unbalanced.body", { total: formatPct(totalWeight, 2, lang) })}
          </Text>
        </Callout>
      )}

      {result && (
        <Callout title={t("alloc.callout.period.title")} color="emerald" className="border-emerald-800 bg-emerald-950/40">
          <Text className="text-emerald-300">
            {t("alloc.callout.period.body", {
              start: result.startMonth,
              end: result.endMonth,
              months: String(result.months.length),
              name: result.limitingTickerName,
              ticker: result.limitingTicker,
              endLimiter: result.limitingEndTicker && result.limitingEndTicker !== result.limitingTicker
                ? `, fin limitée par ${result.limitingEndTickerName} (${result.limitingEndTicker})`
                : "",
            })}
          </Text>
        </Callout>
      )}

      {result?.marginEnabled && (
        <Callout title={t("alloc.callout.margin.title", { leverage: result.marginLeverage.toFixed(2) })} color="amber" className="border-amber-800 bg-amber-950/40">
          <Text className="text-amber-300">
            {t("alloc.callout.margin.body", { loan: formatEUR(result.loanAmount, lang), rate: formatPct(marginLoanRatePct, 2, lang), freq: marginInterestFreq === "monthly" ? t("alloc.callout.margin.freqMonthly") : t("alloc.callout.margin.freqYearly"), interest: formatEUR(result.totalInterestPaid, lang) })}
          </Text>
        </Callout>
      )}

      {result?.liquidationMonth && (
        <Callout title={t("alloc.callout.liquidation.title")} color="rose" className="border-rose-800 bg-rose-950/40">
          <Text className="text-rose-300">
            {t("alloc.callout.liquidation.body", { month: result.liquidationMonth })}
          </Text>
        </Callout>
      )}

      <Grid numItems={1} numItemsMd={2} className="gap-6">
        {/* ─── Left column ─── */}
        <Col className="space-y-6">
          {/* Ticker picker */}
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
            <div className="flex items-center justify-between mb-4">
              <Title className="text-tremor-content-strong dark:text-slate-100">{t("alloc.col.assets.title")}</Title>
              <Text className="text-tremor-content dark:text-slate-400 text-xs">
                {t("alloc.col.assets.selected", { n: String(selectedTickers.length) })}
              </Text>
            </div>

            {/* Filter input */}
            <div className="mb-3">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={t("alloc.col.assets.filterPlaceholder")}
                className="w-full rounded-tremor-small bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
              {Object.entries(filteredGroups).map(([cls, list]) => (
                <div key={cls}>
                  <Text className="text-tremor-content dark:text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    {t(CLASS_KEYS[cls] ?? `alloc.classLabel.${cls}`)}
                  </Text>
                   <Grid numItems={2} numItemsSm={3} className="gap-2">
                    {list.map((t) => {
                      const isSelected = selectedTickers.includes(t.ticker);
                      const isCustom = customTickers[t.ticker] !== undefined;
  return (
                        <button
                          key={t.ticker}
                          type="button"
                          onClick={() => toggleTicker(t.ticker)}
                          className={`flex items-center gap-2 rounded-tremor-default border px-2.5 py-2 text-left transition-colors ${
                            isSelected
                              ? "border-emerald-500/50 bg-emerald-500/10"
                              : "border-slate-700 bg-slate-800/50 hover:bg-slate-800"
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <Text className={`text-sm font-medium truncate ${isSelected ? "text-emerald-300" : "text-slate-300"}`}>
                                {t.ticker}
                              </Text>
                              {isCustom && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700 text-slate-400 shrink-0">
                                  Custom
                                </span>
                              )}
                            </div>
                            <Text className="text-xs text-slate-500 truncate">{t.name}</Text>
                          </div>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCustomTicker(t.ticker);
                              }}
                              className="shrink-0 text-slate-500 hover:text-rose-400 transition-colors"
                              title={t("alloc.col.assets.delete")}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                        </button>
                      );
                    })}
                  </Grid>
                </div>
              ))}
            </div>
          </Card>

          {/* Custom ticker input */}
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-3 text-base">
              {t("alloc.col.assets.customTitle")}
            </Title>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => {
                  setCustomInput(e.target.value);
                  setCustomError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustom();
                }}
                placeholder={t("alloc.col.assets.customPlaceholder")}
                className="flex-1 rounded-tremor-small bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
              <Button
                size="sm"
                onClick={handleAddCustom}
                disabled={customLoading || !customInput.trim()}
                className="bg-tremor-brand dark:bg-emerald-600 text-white shrink-0"
              >
                {customLoading ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">{t("alloc.col.assets.customLoading")}</span>
                  </div>
                ) : (
                  t("alloc.col.assets.customAdd")
                )}
              </Button>
            </div>
            {customError && (
              <Callout title={t("alloc.callout.error.title")} color="rose" className="mt-3 border-rose-800 bg-rose-950/40">
                <Text className="text-rose-300 text-xs">
                  {customError.startsWith("alloc.custom.alreadyExists:")
                    ? t("alloc.custom.alreadyExists", { ticker: customError.split(":")[1] })
                    : t(customError)}
                </Text>
              </Callout>
            )}

            {/* Custom ticker list with refresh */}
            {Object.keys(customTickers).length > 0 && (
              <div className="mt-3 space-y-1.5">
                <Text className="text-tremor-content dark:text-slate-500 text-xs font-medium">{t("alloc.col.assets.customList")}</Text>
                {Object.values(customTickers).map((ct) => (
                  <div key={ct.ticker} className="flex items-center justify-between rounded-tremor-small bg-slate-800/50 border border-slate-700/50 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ct.color }} />
                      <Text className="text-sm text-slate-300 truncate">{ct.ticker}</Text>
                      <Text className="text-xs text-slate-500 truncate">{ct.startDate} → {ct.endDate}</Text>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => refreshCustomTicker(ct.ticker)}
                        className="bg-slate-700 text-slate-300 hover:bg-slate-600"
                      >
                        {t("alloc.col.assets.refresh")}
                      </Button>
                      <button
                        type="button"
                        onClick={() => removeCustomTicker(ct.ticker)}
                        className="text-slate-500 hover:text-rose-400 transition-colors"
                        title={t("alloc.col.assets.delete")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Weight sliders */}
          {selectedTickers.length > 0 && (
            <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
              <div className="flex items-center justify-between mb-4">
                <Title className="text-tremor-content-strong dark:text-slate-100">{t("alloc.col.weights.title")}</Title>
                <Badge
                  color={isBalanced ? "emerald" : "amber"}
                  className={isBalanced ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}
                >
                  {t("alloc.col.weights.total", { total: formatPct(totalWeight, 2, lang) })} {isBalanced ? "" : t("alloc.col.weights.autoNormalized")}
                </Badge>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <Button
                  size="xs"
                  variant={autoNormalize ? "primary" : "secondary"}
                  onClick={() => setAutoNormalize((v) => !v)}
                  className={autoNormalize ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}
                >
                  {t("alloc.col.weights.autoNormalize")} : {autoNormalize ? "ON" : "OFF"}
                </Button>
              </div>

              <div className="space-y-3">
                {selectedTickers.map((ticker) => {
                  const meta = allTickers.find((x) => x.ticker === ticker);
                  const weight = weights[ticker] ?? 0;
                  const isLocked = locked[ticker] ?? false;
                  return (
                    <div key={ticker} className="overflow-hidden">
                      {/* Mobile: 2-row layout */}
                      <div className="flex sm:hidden flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleLock(ticker)}
                            className={`shrink-0 w-6 h-6 rounded-tremor-small flex items-center justify-center border transition-colors ${
                              isLocked
                                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                                : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                            }`}
                            title={isLocked ? t("alloc.col.weights.unlock") : t("alloc.col.weights.lock")}
                          >
                            {isLocked ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                              </svg>
                            )}
                          </button>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? "#94a3b8" }} />
                          <Text className="text-tremor-content dark:text-slate-300 text-sm truncate flex-1 min-w-0">
                            {meta?.name ?? ticker}
                          </Text>
                          <div className="w-20 shrink-0">
                            <NumberInput
                              value={weight}
                              onValueChange={(v) => handleWeightChange(ticker, v ?? 0)}
                              min={0}
                              max={100}
                              step={0.5}
                              disabled={isLocked && autoNormalize}
                              className="bg-slate-900 border-slate-800 text-slate-200"
                            />
                          </div>
                        </div>
                        <div className="pl-8">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={weight}
                            onChange={(e) => handleWeightChange(ticker, Number(e.target.value))}
                            disabled={isLocked && autoNormalize}
                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>

                      {/* Desktop: single row */}
                      <div className="hidden sm:flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleLock(ticker)}
                          className={`shrink-0 w-7 h-7 rounded-tremor-small flex items-center justify-center border transition-colors ${
                            isLocked
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                              : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                          }`}
                          title={isLocked ? t("alloc.col.weights.unlock") : t("alloc.col.weights.lock")}
                        >
                          {isLocked ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                            </svg>
                          )}
                        </button>

                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? "#94a3b8" }} />

                        <Text className="text-tremor-content dark:text-slate-300 text-sm w-24 lg:w-32 shrink-0 truncate">
                          {meta?.name ?? ticker}
                        </Text>

                        <div className="flex-1 min-w-0">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={weight}
                            onChange={(e) => handleWeightChange(ticker, Number(e.target.value))}
                            disabled={isLocked && autoNormalize}
                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </div>

                        <div className="w-20 lg:w-24 shrink-0">
                          <NumberInput
                            value={weight}
                            onValueChange={(v) => handleWeightChange(ticker, v ?? 0)}
                            min={0}
                            max={100}
                            step={0.5}
                            disabled={isLocked && autoNormalize}
                            className="bg-slate-900 border-slate-800 text-slate-200"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="xs" variant="secondary" onClick={() => applyPreset("golden")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.golden")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("60/40")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.6040")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("all-weather")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.allWeather")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("equal-weight")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.equalWeight")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("aggressive")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.aggressive")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("golden-2x")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.golden2x")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("golden-3x")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.golden3x")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => applyPreset("nasdaq-2x")} className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {t("alloc.preset.nasdaq2x")}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="xs" variant="secondary" onClick={() => runOptimizer("cagr")} disabled={optimizing !== null} className="bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-800/50 disabled:opacity-50">
                  {optimizing === "cagr" ? `${t("alloc.optimize.running")} ${Math.round(optProgress * 100)}%` : t("alloc.optimize.cagr")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => runOptimizer("sharpe")} disabled={optimizing !== null} className="bg-sky-900/40 text-sky-300 border border-sky-700/40 hover:bg-sky-800/50 disabled:opacity-50">
                  {optimizing === "sharpe" ? `${t("alloc.optimize.running")} ${Math.round(optProgress * 100)}%` : t("alloc.optimize.sharpe")}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => runOptimizer("minVol")} disabled={optimizing !== null} className="bg-rose-900/40 text-rose-300 border border-rose-700/40 hover:bg-rose-800/50 disabled:opacity-50">
                  {optimizing === "minVol" ? `${t("alloc.optimize.running")} ${Math.round(optProgress * 100)}%` : t("alloc.optimize.minVol")}
                </Button>
              </div>
            </Card>
          )}

          {/* Configuration */}
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-4">{t("alloc.col.config")}</Title>
            <Grid numItems={1} numItemsSm={2} className="gap-4">
              <Col>
                <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.investment")}</Text>
                <NumberInput
                  value={initialInvestment}
                  onValueChange={(v) => setInitialInvestment(Math.max(0, v ?? 0))}
                  min={0}
                  step={1000}
                  className="bg-slate-900 border-slate-800 text-slate-200"
                />
              </Col>
              <Col>
                <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.monthly")}</Text>
                <NumberInput
                  value={monthlyContribution}
                  onValueChange={(v) => setMonthlyContribution(Math.max(0, v ?? 0))}
                  min={0}
                  step={50}
                  className="bg-slate-900 border-slate-800 text-slate-200"
                />
              </Col>
              <Col>
                <LabelWithHelp labelKey="alloc.col.config.contribStop" helpKey="alloc.col.config.contribStop.help">
                  <NumberInput
                    value={contribStopYears}
                    onValueChange={(v) => setContribStopYears(Math.max(0, Math.round(v ?? 0)))}
                    min={0}
                    step={1}
                    className="bg-slate-900 border-slate-800 text-slate-200"
                  />
                </LabelWithHelp>
              </Col>
              <Col>
                <LabelWithHelp labelKey="alloc.col.config.rebalance" helpKey="alloc.col.config.rebalance.help">
                  <Select value={rebalance} onValueChange={(v) => setRebalance(v as SimulationInput["rebalance"])} className="bg-slate-900 border-slate-800 text-slate-200">
                    <SelectItem value="none">{t("alloc.col.config.rebalance.none")}</SelectItem>
                    <SelectItem value="monthly">{t("alloc.col.config.rebalance.monthly")}</SelectItem>
                    <SelectItem value="quarterly">{t("alloc.col.config.rebalance.quarterly")}</SelectItem>
                    <SelectItem value="annual">{t("alloc.col.config.rebalance.annual")}</SelectItem>
                    <SelectItem value="threshold5">{t("alloc.col.config.rebalance.threshold5")}</SelectItem>
                    <SelectItem value="bands5_25">{t("alloc.col.config.rebalance.bands5_25")}</SelectItem>
                  </Select>
                </LabelWithHelp>
              </Col>
              <Col>
                <LabelWithHelp labelKey="alloc.col.config.inflation" helpKey="alloc.col.config.inflation.help">
                  <NumberInput
                    value={inflationPct}
                    onValueChange={(v) => setInflationPct(Math.max(0, Math.min(20, v ?? 0)))}
                    min={0}
                    max={20}
                    step={0.1}
                    className="bg-slate-900 border-slate-800 text-slate-200"
                  />
                </LabelWithHelp>
              </Col>
            </Grid>

            {/* Margin loan */}
            <div className="mt-5 pt-4 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="group relative inline-block">
                    <Title className="text-tremor-content-strong dark:text-slate-100 text-base cursor-help">{t("alloc.col.config.margin.title")}</Title>
                    <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                      {t("alloc.col.config.margin.title.help")}
                    </div>
                  </div>
                <div className="group relative inline-block">
                    <Button
                      size="xs"
                      variant={marginEnabled ? "primary" : "secondary"}
                      onClick={() => setMarginEnabled((v) => !v)}
                      className={marginEnabled ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}
                    >
                      {t("alloc.col.config.margin.title")} : {marginEnabled ? "ON" : "OFF"}
                    </Button>
                    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                      {t("alloc.col.config.margin.title.help")}
                    </div>
                  </div>
              </div>
              {marginEnabled && (
                <>
                  <Text className="text-tremor-content dark:text-slate-500 text-xs mb-3">
                    {t("alloc.col.config.margin.explain", { loan: formatEUR(loanPreview, lang), leverage: marginLeverage.toFixed(2) })}
                  </Text>
                  <Grid numItems={1} numItemsSm={2} className="gap-4">
                    <Col>
                      <LabelWithHelp labelKey="alloc.col.config.margin.leverage" helpKey="alloc.col.config.margin.leverage.help">
                        <NumberInput
                          value={marginLeverage}
                          onValueChange={(v) => setMarginLeverage(Math.max(1, Math.min(5, v ?? 1)))}
                          min={1}
                          max={5}
                          step={0.1}
                          className="bg-slate-900 border-slate-800 text-slate-200"
                        />
                      </LabelWithHelp>
                    </Col>
                    <Col>
                      <LabelWithHelp labelKey="alloc.col.config.margin.rate" helpKey="alloc.col.config.margin.rate.help">
                        <NumberInput
                          value={marginLoanRatePct}
                          onValueChange={(v) => setMarginLoanRatePct(Math.max(0, Math.min(50, v ?? 0)))}
                          min={0}
                          max={50}
                          step={0.1}
                          className="bg-slate-900 border-slate-800 text-slate-200"
                        />
                      </LabelWithHelp>
                    </Col>
                  </Grid>
                  <Grid numItems={1} numItemsSm={2} className="gap-4 mt-4">
                    <Col>
                      <LabelWithHelp labelKey="alloc.col.config.margin.freq" helpKey="alloc.col.config.margin.freq.help">
                        <Select
                          value={marginInterestFreq}
                          onValueChange={(v) => setMarginInterestFreq(v as SimulationInput["marginInterestFreq"])}
                          className="bg-slate-900 border-slate-800 text-slate-200"
                        >
                          <SelectItem value="monthly">{t("alloc.col.config.margin.freqMonthly")}</SelectItem>
                          <SelectItem value="yearly">{t("alloc.col.config.margin.freqYearly")}</SelectItem>
                        </Select>
                      </LabelWithHelp>
                    </Col>
                    <Col>
                      <LabelWithHelp labelKey="alloc.col.config.margin.maint" helpKey="alloc.col.config.margin.maint.help">
                        <div className="flex items-center gap-2">
                          <NumberInputField
                            value={marginMaintenancePct}
                            onCommit={(v) => setMarginMaintenancePct(v)}
                            min={10}
                            max={50}
                            step={1}
                          />
                          <a
                            href="/FFunds/comptes#margin"
                            className="shrink-0 whitespace-nowrap rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[10px] font-medium text-orange-300 transition-colors hover:bg-orange-500/20"
                          >
                            {t("alloc.col.config.margin.maint.explain")}
                          </a>
                        </div>
                      </LabelWithHelp>
                    </Col>
                  </Grid>

                  <div className="mt-4 pt-3 border-t border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="group relative inline-block">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm font-medium cursor-help">{t("alloc.col.config.margin.relevTitle")}</Text>
                        <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                          {t("alloc.col.config.margin.relevTitle.help")}
                        </div>
                      </div>
                      <div className="group relative inline-block">
                        <Button
                          size="xs"
                          variant={marginRebalance ? "primary" : "secondary"}
                          onClick={() => setMarginRebalance((v) => !v)}
                          className={marginRebalance ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}
                        >
                          Re-leverage : {marginRebalance ? "ON" : "OFF"}
                        </Button>
                        <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                          {t("alloc.col.config.margin.relevTitle.help")}
                        </div>
                      </div>
                    </div>
                    {marginRebalance && (
                      <>
                        <Text className="text-tremor-content dark:text-slate-500 text-xs mb-2">
                          {t("alloc.col.config.margin.relevExplain")}
                        </Text>
                        <div className="max-w-xs">
                          <LabelWithHelp labelKey="alloc.col.config.margin.relevModeLabel" helpKey="alloc.col.config.margin.relevModeLabel.help">
                            <Select
                              value={marginRebalanceMode}
                              onValueChange={(v) => setMarginRebalanceMode(v as SimulationInput["marginRebalanceMode"])}
                              className="bg-slate-900 border-slate-800 text-slate-200"
                            >
                              <SelectItem value="gains-only">{t("alloc.col.config.margin.relevModeGains")}</SelectItem>
                              <SelectItem value="bidirectional">{t("alloc.col.config.margin.relevModeBi")}</SelectItem>
                            </Select>
                          </LabelWithHelp>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>
        </Col>

        {/* ─── Right column ─── */}
        <Col>
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border h-full">
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-4">{t("alloc.col.resultsTitle")}</Title>

            {isPending && (
              <div className="flex items-center gap-2 mb-4">
                <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <Text className="text-tremor-content dark:text-slate-400 text-sm">{t("alloc.computing")}</Text>
              </div>
            )}

            {selectedTickers.length === 0 && (
              <Callout title={t("alloc.callout.noAssets.title")} color="amber" className="border-amber-800 bg-amber-950/40">
                <Text className="text-amber-300">
                  {t("alloc.callout.noAssets.body")}
                </Text>
              </Callout>
            )}

            {result && (
              <>
                {/* Metrics */}
                <Grid numItems={2} numItemsSm={3} className="gap-3 mb-6">
                  <MetricCard labelKey="alloc.metrics.finalValue" helpKey="alloc.metrics.finalValue.help" metricClass="text-tremor-content-strong dark:text-slate-100">
                    {formatEUR(result.finalValue, lang)}
                  </MetricCard>
                  <MetricCard labelKey="alloc.metrics.totalInvested" helpKey="alloc.metrics.totalInvested.help" metricClass="text-tremor-content-strong dark:text-slate-100">
                    {formatEUR(result.totalInvested, lang)}
                  </MetricCard>
                  <MetricCard labelKey="alloc.metrics.volatility" helpKey="alloc.metrics.volatility.help" metricClass="text-tremor-content-strong dark:text-slate-100">
                    {formatPct(result.volatility * 100, 2, lang)}
                  </MetricCard>
                  <MetricCard labelKey="alloc.metrics.cagr" helpKey="alloc.metrics.cagr.help" metricClass="text-tremor-brand dark:text-emerald-400">
                    {formatPct(result.cagr * 100, 2, lang)}
                  </MetricCard>
                  {result.inflationPct > 0 && (
                    <MetricCard labelKey="alloc.metrics.cagrReal" helpKey="alloc.metrics.cagrReal.help" metricClass="text-teal-400">
                      {formatPct(result.realCagr * 100, 2, lang)}
                    </MetricCard>
                  )}
                  <MetricCard labelKey="alloc.metrics.maxDrawdown" helpKey="alloc.metrics.maxDrawdown.help" metricClass="text-rose-400">
                    {formatPct(result.maxDrawdown * 100, 2, lang)}
                  </MetricCard>
                  <MetricCard labelKey="alloc.metrics.sharpe" helpKey="alloc.metrics.sharpe.help" metricClass="text-tremor-brand dark:text-emerald-400">
                    {result.sharpe.toFixed(2)}
                  </MetricCard>
                  {result.inflationPct > 0 && (
                    <>
                      <MetricCard labelKey="alloc.metrics.finalValueReal" helpKey="alloc.metrics.finalValueReal.help" metricClass="text-teal-400">
                        {formatEUR(result.finalValueReal, lang)}
                      </MetricCard>
                      <MetricCard labelKey="alloc.metrics.totalInvestedReal" helpKey="alloc.metrics.totalInvestedReal.help" metricClass="text-teal-400">
                        {formatEUR(result.totalInvestedReal, lang)}
                      </MetricCard>
                    </>
                  )}
                  {result.marginEnabled && (
                    <>
                      <MetricCard labelKey="alloc.metrics.loan" helpKey="alloc.metrics.loan.help" metricClass="text-amber-400">
                        {formatEUR(result.loanAmount, lang)}
                      </MetricCard>
                      <MetricCard labelKey="alloc.metrics.interestPaid" helpKey="alloc.metrics.interestPaid.help" metricClass="text-amber-400">
                        {formatEUR(result.totalInterestPaid, lang)}
                      </MetricCard>
                      <MetricCard labelKey="alloc.metrics.leverage" helpKey="alloc.metrics.leverage.help" metricClass="text-amber-400">
                        {result.marginLeverage.toFixed(2)}×
                      </MetricCard>
                    </>
                  )}
                </Grid>

                {/* Time window */}
                <div className="mb-4 pt-4 border-t border-slate-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <Title className="text-tremor-content-strong dark:text-slate-100 text-base">{t("alloc.col.config.window.title")}</Title>
                    <div className="flex gap-1">
                      {(["all", "lastN", "custom"] as const).map((m) => (
                        <Button
                          key={m}
                          size="xs"
                          variant={windowMode === m ? "primary" : "secondary"}
                          onClick={() => setWindowMode(m)}
                          className={windowMode === m ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}
                        >
                          {t(`alloc.col.config.window.mode.${m}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {windowMode === "lastN" && (
                    <Col>
                      <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.yearsBack")}</Text>
                      <NumberInput
                        value={yearsBack}
                        onValueChange={(v) => setYearsBack(Math.max(1, Math.min(50, Math.round(v ?? 1))))}
                        min={1}
                        max={50}
                        step={1}
                        className="bg-slate-900 border-slate-800 text-slate-200"
                      />
                    </Col>
                  )}
                  {windowMode === "custom" && (
                    <Grid numItems={1} numItemsSm={2} className="gap-4">
                      <Col>
                        <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.start")}</Text>
                        <input
                          type="date"
                          value={customStart ? customStart + "-01" : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCustomStart(v ? v.slice(0, 7) : "");
                          }}
                          className="bg-slate-900 border border-slate-800 text-slate-200 rounded-md px-3 py-2 w-full text-sm"
                        />
                      </Col>
                      <Col>
                        <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.end")}</Text>
                        <input
                          type="date"
                          value={customEnd ? customEnd + "-01" : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setCustomEnd(v ? v.slice(0, 7) : "");
                          }}
                          className="bg-slate-900 border border-slate-800 text-slate-200 rounded-md px-3 py-2 w-full text-sm"
                        />
                      </Col>
                    </Grid>
                  )}
                </div>

                {/* Charts */}
                <TabGroup defaultIndex={0}>
                  <TabList className="bg-slate-800/50 border-slate-700/50">
                    <Tab className="text-slate-400 data-[selected]:text-emerald-400 data-[selected]:border-b-emerald-400">{t("alloc.chart.performance")}</Tab>
                    <Tab className="text-slate-400 data-[selected]:text-emerald-400 data-[selected]:border-b-emerald-400">{t("alloc.chart.drawdown")}</Tab>
                    <Tab className="text-slate-400 data-[selected]:text-emerald-400 data-[selected]:border-b-emerald-400">{t("alloc.chart.correlation")}</Tab>
                    <Tab className="text-slate-400 data-[selected]:text-emerald-400 data-[selected]:border-b-emerald-400">{t("alloc.chart.yearly")}</Tab>
                  </TabList>
                  <TabPanels>
                    <TabPanel>
                      <div className="mt-4">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.portfolioEvolution")}</Text>
                        <ResponsiveContainer width="100%" height={320}>
                          <ComposedChart data={portfolioChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fill: "#94a3b8", fontSize: 11 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              tickFormatter={(v: number) => formatCompactEUR(v, lang)}
                              width={80}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            {result.marginEnabled ? (
                              <>
                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  stroke="#94a3b8"
                                  fill="#94a3b8"
                                  fillOpacity={0.05}
                                  strokeWidth={1}
                                  dot={false}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="equity"
                                  stroke="#34d399"
                                  fill="#34d399"
                                  fillOpacity={0.08}
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4, fill: "#34d399" }}
                                />
                                {result.inflationPct > 0 && (
                                  <Line
                                    type="monotone"
                                    dataKey="equityReal"
                                    stroke="#0d9488"
                                    strokeWidth={1.5}
                                    strokeDasharray="1 3"
                                    dot={false}
                                    name={`${t("alloc.chart.equityLabel")} (${t("alloc.real.suffix")})`}
                                  />
                                )}
                                <Line
                                  type="monotone"
                                  dataKey="loan"
                                  stroke="#f87171"
                                  strokeDasharray="3 3"
                                  strokeWidth={1.5}
                                  dot={false}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="invested"
                                  stroke="#64748b"
                                  strokeDasharray="5 5"
                                  strokeWidth={2}
                                  dot={false}
                                />
                              </>
                            ) : (
                              <>
                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  stroke="#34d399"
                                  fill="#34d399"
                                  fillOpacity={0.08}
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4, fill: "#34d399" }}
                                />
                                {result.inflationPct > 0 && (
                                  <Line
                                    type="monotone"
                                    dataKey="equityReal"
                                    stroke="#0d9488"
                                    strokeWidth={1.5}
                                    strokeDasharray="1 3"
                                    dot={false}
                                    name={`${t("alloc.chart.equityLabel")} (${t("alloc.real.suffix")})`}
                                  />
                                )}
                                <Line
                                  type="monotone"
                                  dataKey="invested"
                                  stroke="#64748b"
                                  strokeDasharray="5 5"
                                  strokeWidth={2}
                                  dot={false}
                                />
                              </>
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                        <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
                          {result.marginEnabled ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-1 rounded-full bg-emerald-400" />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.equityLabel")}</Text>
                              </div>
                              {result.inflationPct > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <span className="w-3 h-0.5 rounded-full" style={{ borderTop: "2px dashed #0d9488" }} />
                                  <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.equityLabel")} ({t("alloc.real.suffix")})</Text>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-1 rounded-full bg-slate-400" />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.assetsLabel")}</Text>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-0.5 rounded-full bg-rose-400" style={{ borderTop: "2px dashed #f87171" }} />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.loan")}</Text>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-0.5 rounded-full bg-slate-500" style={{ borderTop: "2px dashed #64748b" }} />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.invested")}</Text>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-1 rounded-full bg-emerald-400" />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.valuePortfolio")}</Text>
                              </div>
                              {result.inflationPct > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <span className="w-3 h-0.5 rounded-full" style={{ borderTop: "2px dashed #0d9488" }} />
                                  <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.valuePortfolio")} ({t("alloc.real.suffix")})</Text>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5">
                                <span className="w-3 h-0.5 rounded-full bg-slate-500" style={{ borderTop: "2px dashed #64748b" }} />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.invested")}</Text>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </TabPanel>

                    <TabPanel>
                      <div className="mt-4">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.drawdownOverTime")}</Text>
                        <ResponsiveContainer width="100%" height={320}>
                          <ComposedChart data={drawdownChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fill: "#94a3b8", fontSize: 11 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              tickFormatter={(v: number) => `${v.toFixed(1)} %`}
                              width={60}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="drawdown"
                              stroke="#f87171"
                              fill="#f87171"
                              fillOpacity={0.25}
                              strokeWidth={2}
                              dot={false}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </TabPanel>

                    <TabPanel>
                      <div className="mt-4">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.correlationDesc")}</Text>
                        {correlationMatrix ? (
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-center text-xs">
                              <thead>
                                <tr className="border-b border-slate-700 bg-slate-900/60">
                                  <th className="px-2 py-2 font-semibold text-slate-500 sticky left-0 bg-slate-900/60"></th>
                                  {selectedTickers.map((t) => {
                                    const meta = allTickers.find((x) => x.ticker === t);
                                    return <th key={t} className="px-2 py-2 font-semibold text-slate-300 whitespace-nowrap" title={meta?.name ?? t}>{meta?.name ?? t}</th>;
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {correlationMatrix.map((row, i) => {
                                  const t1 = selectedTickers[i];
                                  const meta1 = allTickers.find((x) => x.ticker === t1);
                                  return (
                                    <tr key={t1} className="border-b border-slate-800">
                                      <td className="px-2 py-2 font-semibold text-slate-300 whitespace-nowrap sticky left-0 bg-slate-900/60" title={meta1?.name ?? t1}>{meta1?.name ?? t1}</td>
                                      {row.map((v, j) => {
                                        const pct = Math.round(v * 100);
                                        const bg = v >= 0.7 ? `rgba(239,68,68,${0.15 + v * 0.55})`
                                          : v >= 0.3 ? `rgba(251,191,36,${0.1 + v * 0.4})`
                                          : v <= -0.3 ? `rgba(34,197,94,${0.15 + Math.abs(v) * 0.45})`
                                          : "rgba(148,163,184,0.1)";
                                        return (
                                          <td key={j} className="px-2 py-2 tabular-nums" style={{ background: bg }} title={`${pct}%`}>
                                            {pct}%
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <Text className="text-slate-500 text-xs mt-4">{t("alloc.chart.correlationNeed")}</Text>
                        )}
                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.6)" }} />{t("alloc.chart.correlationHigh")}</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(251,191,36,0.4)" }} />{t("alloc.chart.correlationMedium")}</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(34,197,94,0.5)" }} />{t("alloc.chart.correlationLow")}</span>
                        </div>
                      </div>
                    </TabPanel>

                    <TabPanel>
                      <div className="mt-4">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.yearlyDesc")}</Text>
                        <ResponsiveContainer width="100%" height={400}>
                          <ComposedChart data={yearlyChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tickFormatter={(v: number) => formatCompactEUR(v, lang)} tick={{ fill: "#94a3b8", fontSize: 12 }} width={80} />
                            <Tooltip content={<CustomTooltip />} />
                            <ReferenceLine y={0} stroke="#475569" />
                            <Bar dataKey="invested" name={t("alloc.chart.invested")} fill="#64748b" radius={[2, 2, 0, 0]} stackId="a" />
                            <Bar dataKey="gain" name={t("alloc.chart.gain")} radius={[2, 2, 0, 0]} stackId="a">
                              {yearlyChartData.map((entry, index) => (
                                <Cell key={`g-${index}`} fill={entry.gain >= 0 ? "#34d399" : "#f87171"} />
                              ))}
                            </Bar>
                            <Bar dataKey="interest" name={t("alloc.metrics.interestPaid")} fill="#fbbf24" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="equityEnd" name={t("alloc.metrics.finalValue")} fill="#10b981" fillOpacity={0.15} radius={[2, 2, 0, 0]} />
                            {result.inflationPct > 0 && (
                              <Bar dataKey="equityEndReal" name={t("alloc.metrics.finalValueReal")} fill="#0d9488" fillOpacity={0.15} radius={[2, 2, 0, 0]} />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-slate-500" />
                            <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.invested")}</Text>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-emerald-400" />
                            <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.gain")}</Text>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-amber-400" />
                            <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.interestPaid")}</Text>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-emerald-500/40" />
                            <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.finalValue")}</Text>
                          </div>
                          {result.inflationPct > 0 && (
                            <div className="flex items-center gap-1.5">
                              <span className="w-3 h-3 rounded-sm bg-teal-600/40" />
                              <Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.finalValueReal")}</Text>
                            </div>
                          )}
                        </div>
                      </div>
                    </TabPanel>
                  </TabPanels>
                </TabGroup>

                {/* Contribution impact per year */}
                {result && monthlyContribution > 0 && contributionImpactData.length > 0 && (
                  <div className="mt-6">
                    <h3 className="mb-1 text-sm font-semibold text-slate-200">{t("alloc.contrib.title")}</h3>
                    <p className="mb-3 text-xs text-slate-500">{t("alloc.contrib.desc")}</p>
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-700 bg-slate-900/60">
                            <th className="px-3 py-2 font-semibold text-slate-300">{t("alloc.contrib.col.year")}</th>
                            <th className="px-3 py-2 font-semibold text-slate-300 text-right">{t("alloc.contrib.col.invested")}</th>
                            <th className="px-3 py-2 font-semibold text-slate-300 text-right">{t("alloc.contrib.col.contribShare")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contributionImpactData.map((row) => {
                            const share = row.equityEnd > 0 ? (row.investedYear / row.equityEnd) * 100 : 0;
                            return (
                              <tr key={row.year} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                                <td className="px-3 py-2 font-medium text-slate-100">{row.year}</td>
                                <td className="px-3 py-2 text-slate-400 tabular-nums text-right">{formatEUR(row.investedYear, lang)}</td>
                                <td className="px-3 py-2 text-emerald-400 tabular-nums text-right">{share.toFixed(1)} %</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </Col>
      </Grid>
    </div>
  );
}

export default function PortfolioAllocator(): JSX.Element {
  return (
    <I18nProvider>
      <PortfolioAllocatorInner />
    </I18nProvider>
  );
}
