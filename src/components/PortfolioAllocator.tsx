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

interface Portfolio {
  id: string;
  name: string;
  collapsed: boolean;
  selectedTickers: string[];
  weights: Record<string, number>;
  locked: Record<string, boolean>;
  autoNormalize: boolean;
  optimizing: OptimizeGoal | null;
  optProgress: number;
}

interface GlobalSimState {
  initialInvestment: number;
  monthlyContribution: number;
  rebalance: SimulationInput["rebalance"];
  inflationPct: number;
  windowMode: SimulationInput["windowMode"];
  yearsBack: number;
  customStart: string;
  customEnd: string;
  contribStopYears: number;
  marginEnabled: boolean;
  marginLeverage: number;
  marginLoanRatePct: number;
  marginInterestFreq: "monthly" | "yearly";
  marginRebalance: boolean;
  marginRebalanceMode: "gains-only" | "bidirectional";
  marginMaintenancePct: number;
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
const PA_LS_KEY = "ffunds:pa-params";
const PA_COOKIE_NAME = "ffunds_pa_params";
const PA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

/*
 * Presets map ticker → weight (%).
 * When applied, any ticker in the preset is auto-selected if not already.
 */
const PRESETS: Record<string, Record<string, number>> = {
  golden: {
    "MSCI-WORLD-MOMENTUM": 20,
    "MSCI-WORLD-SMALL": 9,
    "MSCI-WORLD-QUALITY": 10,
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
    "MSCI-WORLD-SMALL": 9,
    "MSCI-WORLD-QUALITY": 10,
    XLU: 10,
    TLT: 14,
    SHY: 6,
    KMLM: 15,
    GLD: 16,
  },
  "golden-3x": {
    "MSCI-WORLD-MOMENTUM": 20,
    "MSCI-WORLD-SMALL": 9,
    "MSCI-WORLD-QUALITY": 10,
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

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
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
    const lo = isValidMonth(customStart) ? customStart : "";
    const hi = isValidMonth(customEnd) ? customEnd : "";
    const [a, b] = lo && hi && lo > hi ? [hi, lo] : [lo, hi];
    const filtered = allMonths.filter((m) => (a === "" || m >= a) && (b === "" || m <= b));
    months = filtered.length > 0 ? filtered : allMonths;
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

type OptimizeGoal = "cagr" | "sharpe" | "minVol" | "calmar" | "riskParity" | "blackLitterman";

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

// Risk Parity: equal risk contribution. Each asset contributes the same
// volatility to the portfolio. Solved iteratively: start from inverse-vol,
// then rebalance toward equal marginal contributions (Spinu/Chaves formulation).
function riskParityWeights(cov: number[][]): number[] {
  const n = cov.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  // Init: inverse volatility weights
  const invVol = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-12)));
  const sumInv = invVol.reduce((s, v) => s + v, 0);
  let w = invVol.map((v) => v / sumInv);

  // Iterative fixed-point: w_i ∝ (targetRisk_i / marginalContribution_i)
  // For ERC, target = 1/n. Marginal contribution = (Σ w)_i / σ_p.
  for (let iter = 0; iter < 200; iter++) {
    const portVar = w.reduce((s, wi, i) => s + wi * cov[i].reduce((ss, cij, j) => ss + cij * w[j], 0), 0);
    const portVol = Math.sqrt(Math.max(portVar, 1e-12));
    // Risk contribution of asset i = w_i * (Σ w)_i / σ_p
    const rc = w.map((wi, i) => {
      const marginal = cov[i].reduce((ss, cij, j) => ss + cij * w[j], 0) / portVol;
      return wi * marginal;
    });
    const target = portVol / n;
    const newW = rc.map((r) => Math.max(1e-10, target / Math.max(r, 1e-12)));
    const sum = newW.reduce((s, v) => s + v, 0);
    const normalized = newW.map((v) => v / sum);
    const diff = normalized.reduce((s, v, i) => s + Math.abs(v - w[i]), 0);
    w = normalized;
    if (diff < 1e-8) break;
  }
  return w;
}

// Black-Litterman: blend reverse-optimized equilibrium returns (prior) with
// historical mean returns (views, confidence-weighted by inverse historical
// variance). Posterior returns feed a mean-variance optimizer maximizing
// Sharpe. τ = 0.05 confidence in prior; view confidence = 1/histVar.
function blackLittermanWeights(cov: number[][], histMeans: number[], rf: number): number[] {
  const n = cov.length;
  if (n === 0) return [];
  if (n === 1) return [1];

  // Prior: equilibrium excess returns via reverse optimization on inverse-vol weights
  const invVol = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-12)));
  const sumInv = invVol.reduce((s, v) => s + v, 0);
  const wMkt = invVol.map((v) => v / sumInv);
  const tau = 0.05;
  // Π = δ * Σ * w_mkt  where δ = risk aversion. Use Sharpe-implied δ: (μ_p - rf)/σ_p²
  const portRet = wMkt.reduce((s, wi, i) => s + wi * histMeans[i], 0);
  const portVar = wMkt.reduce((s, wi, i) => s + wi * cov[i].reduce((ss, cij, j) => ss + cij * wMkt[j], 0), 0);
  const delta = portVar > 1e-12 ? (portRet - rf) / portVar : 2;
  const pi = cov.map((row, i) => delta * row.reduce((ss, cij, j) => ss + cij * wMkt[j], 0));

  // Views = historical means. P = identity (each asset is its own view).
  // View confidence Ω = diag(histVar). Black-Litterman posterior:
  // μ_BL = [(τΣ)^-1 + Ω^-1]^-1 * [(τΣ)^-1 Π + Ω^-1 q]
  const tauCov = cov.map((row) => row.map((v) => v * tau));
  const omega = histMeans.map((_, i) => Math.max(cov[i][i] * 0.5, 1e-10));

  // Invert (τΣ)^-1 + Ω^-1 via solving linear system (Gauss-Seidel for small n)
  const invTauCov = invertMatrix(tauCov);
  const invOmega = omega.map((o) => 1 / o);
  // A = (τΣ)^-1 + Ω^-1 (diagonal Ω so just add to diagonal)
  const A = invTauCov.map((row, i) => row.map((v, j) => v + (i === j ? invOmega[i] : 0)));
  // b = (τΣ)^-1 Π + Ω^-1 q
  const b = pi.map((p, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) s += invTauCov[i][j] * pi[j];
    return s + invOmega[i] * histMeans[i];
  });
  const Ainv = invertMatrix(A);
  const muBL = Ainv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));

  // Mean-variance optimization on posterior: max Sharpe = μ-μ_rf on efficient frontier.
  // Closed-form tangency portfolio: w ∝ Σ^-1 (μ_BL - rf)
  const excess = muBL.map((m) => m - rf);
  const covInv = invertMatrix(cov);
  const raw = covInv.map((row) => row.reduce((s, v, j) => s + v * excess[j], 0));
  // Long-only: clip negatives, renormalize
  const longOnly = raw.map((v) => Math.max(0, v));
  const sum = longOnly.reduce((s, v) => s + v, 0);
  return sum > 0 ? longOnly.map((v) => v / sum) : wMkt;
}

// Matrix inverse via Gauss-Jordan elimination (small dense matrices, n ≤ ~30)
function invertMatrix(m: number[][]): number[][] {
  const n = m.length;
  const aug = m.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    if (Math.abs(aug[pivot][col]) < 1e-12) continue;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const pv = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

// Compute monthly covariance and mean returns from aligned price history.
function computeStats(allPrices: PricesMap, tickers: string[]): { cov: number[][]; means: number[] } | null {
  const { months, lookups } = intersectPeriod(allPrices, tickers);
  if (months.length < 12) return null;
  const n = tickers.length;
  const returns: number[][] = [];
  for (let i = 1; i < months.length; i++) {
    let valid = true;
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      const prev = lookups[j][months[i - 1]];
      const cur = lookups[j][months[i]];
      if (prev == null || cur == null || prev <= 0) { valid = false; break; }
      row.push(cur / prev - 1);
    }
    if (valid) returns.push(row);
  }
  if (returns.length < 12) return null;
  const means = Array(n).fill(0);
  for (const row of returns) for (let j = 0; j < n; j++) means[j] += row[j];
  for (let j = 0; j < n; j++) means[j] /= returns.length;
  const cov = Array(n).fill(0).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (const row of returns) s += (row[i] - means[i]) * (row[j] - means[j]);
      cov[i][j] = s / returns.length;
    }
  }
  return { cov, means };
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

  // Closed-form strategies skip the random search
  if (goal === "riskParity" || goal === "blackLitterman") {
    const stats = computeStats(allPrices, base.tickers);
    if (!stats) return null;
    const w = goal === "riskParity"
      ? riskParityWeights(stats.cov)
      : blackLittermanWeights(stats.cov, stats.means, RISK_FREE_RATE);
    if (onProgress) onProgress(1);
    return { weights: w.map((v) => Math.round(v * 10000) / 100), marginEnabled: false, marginLeverage: 1 };
  }

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
      case "calmar":
        // Calmar = CAGR / Max Drawdown. Penalize zero/high drawdown.
        metric = res.maxDrawdown > 0.001 ? res.cagr / res.maxDrawdown : -Infinity;
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

const OPT_COLORS: Record<string, string> = {
  emerald: "bg-emerald-900/40 text-emerald-300 border-emerald-700/40 hover:bg-emerald-800/50",
  sky: "bg-sky-900/40 text-sky-300 border-sky-700/40 hover:bg-sky-800/50",
  rose: "bg-rose-900/40 text-rose-300 border-rose-700/40 hover:bg-rose-800/50",
  amber: "bg-amber-900/40 text-amber-300 border-amber-700/40 hover:bg-amber-800/50",
  violet: "bg-violet-900/40 text-violet-300 border-violet-700/40 hover:bg-violet-800/50",
  teal: "bg-teal-900/40 text-teal-300 border-teal-700/40 hover:bg-teal-800/50",
};

const OPT_LABEL_KEY: Record<OptimizeGoal, string> = {
  cagr: "alloc.optimize.cagr",
  sharpe: "alloc.optimize.sharpe",
  minVol: "alloc.optimize.minVol",
  calmar: "alloc.optimize.calmar",
  riskParity: "alloc.optimize.riskParity",
  blackLitterman: "alloc.optimize.blackLitterman",
};

const OptButton = ({
  goal,
  running,
  progress,
  onClick,
  color,
  t,
}: {
  goal: OptimizeGoal;
  running: OptimizeGoal | null;
  progress: number;
  onClick: (g: OptimizeGoal) => void;
  color: string;
  t: (k: string) => string;
}) => (
  <div className="group relative inline-block">
    <Button
      size="xs"
      variant="secondary"
      onClick={() => onClick(goal)}
      disabled={running !== null}
      className={`${OPT_COLORS[color] ?? OPT_COLORS.emerald} disabled:opacity-50`}
    >
      {running === goal ? `${t("alloc.optimize.running")} ${Math.round(progress * 100)}%` : t(OPT_LABEL_KEY[goal])}
    </Button>
    <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-72 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
      {t(`alloc.optimize.help.${goal}`)}
    </div>
  </div>
);

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

function makePortfolioId(): string {
  return `pf_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function makeDefaultPortfolio(name: string): Portfolio {
  return {
    id: makePortfolioId(),
    name,
    collapsed: false,
    selectedTickers: ["SPY", "SHY"],
    weights: { SPY: 60, SHY: 40 },
    locked: {},
    autoNormalize: false,
    optimizing: null,
    optProgress: 0,
  };
}

function PortfolioAllocatorInner(): JSX.Element {
  const { lang, t } = useI18n();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([makeDefaultPortfolio("Portfolio 1")]);
  const [activePortfolioId, setActivePortfolioId] = useState<string>(() => {
    // Will be reconciled with portfolios in effect.
    return "";
  });

  const [initialInvestment, setInitialInvestment] = useState<number>(100000);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(500);
  const [rebalance, setRebalance] = useState<SimulationInput["rebalance"]>("annual");

  const [inflationPct, setInflationPct] = useState<number>(2.5);

  const [windowMode, setWindowMode] = useState<SimulationInput["windowMode"]>("all");
  const [yearsBack, setYearsBack] = useState<number>(10);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [contribStopYears, setContribStopYears] = useState<number>(0);

  const [marginEnabled, setMarginEnabled] = useState<boolean>(false);
  const [marginLeverage, setMarginLeverage] = useState<number>(1.5);
  const [marginLoanRatePct, setMarginLoanRatePct] = useState<number>(5);
  const [marginInterestFreq, setMarginInterestFreq] = useState<SimulationInput["marginInterestFreq"]>("monthly");
  const [marginRebalance, setMarginRebalance] = useState<boolean>(true);
  const [marginRebalanceMode, setMarginRebalanceMode] = useState<SimulationInput["marginRebalanceMode"]>("gains-only");
  const [marginMaintenancePct, setMarginMaintenancePct] = useState<number>(25);

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

  // Load persisted portfolio params on mount (localStorage first, then cookie fallback for legacy)
  useEffect(() => {
    try {
      let raw = localStorage.getItem(PA_LS_KEY);
      if (!raw) raw = readCookie(PA_COOKIE_NAME); // legacy fallback
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<{
        portfolios: Portfolio[];
        global: Partial<GlobalSimState>;
        // Legacy single-portfolio shape (pre-multi-portfolio).
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

      if (Array.isArray(data.portfolios) && data.portfolios.length > 0) {
        const restored = data.portfolios.map((p) => {
          const defaults = makeDefaultPortfolio(p.name || "Portfolio 1");
          return {
            ...defaults,
            ...p,
            id: typeof p.id === "string" && p.id.length > 0 ? p.id : makePortfolioId(),
            collapsed: typeof p.collapsed === "boolean" ? p.collapsed : false,
            selectedTickers: Array.isArray(p.selectedTickers) ? p.selectedTickers : defaults.selectedTickers,
            weights: p.weights && typeof p.weights === "object" ? p.weights : defaults.weights,
            locked: p.locked && typeof p.locked === "object" ? p.locked : {},
            autoNormalize: typeof p.autoNormalize === "boolean" ? p.autoNormalize : false,
            optimizing: null,
            optProgress: 0,
          } as Portfolio;
        });
        setPortfolios(restored);
        if (typeof data.global === "object" && data.global) {
          const g = data.global;
          if (typeof g.initialInvestment === "number") setInitialInvestment(g.initialInvestment);
          if (typeof g.monthlyContribution === "number") setMonthlyContribution(g.monthlyContribution);
          if (g.rebalance) setRebalance(g.rebalance);
          if (typeof g.inflationPct === "number") setInflationPct(g.inflationPct);
          if (g.windowMode === "all" || g.windowMode === "lastN" || g.windowMode === "custom") setWindowMode(g.windowMode);
          if (typeof g.yearsBack === "number") setYearsBack(g.yearsBack);
          if (typeof g.customStart === "string") setCustomStart(g.customStart);
          if (typeof g.customEnd === "string") setCustomEnd(g.customEnd);
          if (typeof g.contribStopYears === "number") setContribStopYears(g.contribStopYears);
          if (typeof g.marginEnabled === "boolean") setMarginEnabled(g.marginEnabled);
          if (typeof g.marginLeverage === "number") setMarginLeverage(g.marginLeverage);
          if (typeof g.marginLoanRatePct === "number") setMarginLoanRatePct(g.marginLoanRatePct);
          if (g.marginInterestFreq) setMarginInterestFreq(g.marginInterestFreq);
          if (typeof g.marginRebalance === "boolean") setMarginRebalance(g.marginRebalance);
          if (g.marginRebalanceMode) setMarginRebalanceMode(g.marginRebalanceMode);
          if (typeof g.marginMaintenancePct === "number") setMarginMaintenancePct(g.marginMaintenancePct);
        }
        // Backward compat: if margin was stored per-portfolio (old shape), hoist from first portfolio.
        if (restored[0] && (restored[0] as Portfolio & { marginEnabled?: boolean }).marginEnabled !== undefined) {
          const first = restored[0] as Portfolio & {
            marginEnabled?: boolean; marginLeverage?: number; marginLoanRatePct?: number;
            marginInterestFreq?: SimulationInput["marginInterestFreq"]; marginRebalance?: boolean;
            marginRebalanceMode?: SimulationInput["marginRebalanceMode"]; marginMaintenancePct?: number;
          };
          if (typeof first.marginEnabled === "boolean") setMarginEnabled(first.marginEnabled);
          if (typeof first.marginLeverage === "number") setMarginLeverage(first.marginLeverage);
          if (typeof first.marginLoanRatePct === "number") setMarginLoanRatePct(first.marginLoanRatePct);
          if (first.marginInterestFreq) setMarginInterestFreq(first.marginInterestFreq);
          if (typeof first.marginRebalance === "boolean") setMarginRebalance(first.marginRebalance);
          if (first.marginRebalanceMode) setMarginRebalanceMode(first.marginRebalanceMode);
          if (typeof first.marginMaintenancePct === "number") setMarginMaintenancePct(first.marginMaintenancePct);
        }
      } else if (Array.isArray(data.selectedTickers) && data.selectedTickers.length > 0) {
        const p = makeDefaultPortfolio("Portfolio 1");
        p.selectedTickers = data.selectedTickers;
        if (data.weights && typeof data.weights === "object") p.weights = data.weights;
        if (typeof data.marginEnabled === "boolean") setMarginEnabled(data.marginEnabled);
        if (typeof data.marginLeverage === "number") setMarginLeverage(data.marginLeverage);
        if (typeof data.marginLoanRatePct === "number") setMarginLoanRatePct(data.marginLoanRatePct);
        if (data.marginInterestFreq) setMarginInterestFreq(data.marginInterestFreq);
        if (typeof data.marginRebalance === "boolean") setMarginRebalance(data.marginRebalance);
        if (data.marginRebalanceMode) setMarginRebalanceMode(data.marginRebalanceMode);
        if (typeof data.marginMaintenancePct === "number") setMarginMaintenancePct(data.marginMaintenancePct);
        setPortfolios([p]);
        if (typeof data.initialInvestment === "number") setInitialInvestment(data.initialInvestment);
        if (typeof data.monthlyContribution === "number") setMonthlyContribution(data.monthlyContribution);
        if (data.rebalance) setRebalance(data.rebalance);
        if (typeof data.inflationPct === "number") setInflationPct(data.inflationPct);
        if (data.windowMode === "all" || data.windowMode === "lastN" || data.windowMode === "custom") setWindowMode(data.windowMode);
        if (typeof data.yearsBack === "number") setYearsBack(data.yearsBack);
        if (typeof data.customStart === "string") setCustomStart(data.customStart);
        if (typeof data.customEnd === "string") setCustomEnd(data.customEnd);
        if (typeof data.contribStopYears === "number") setContribStopYears(data.contribStopYears);
      }
    } catch {
      // ignore corrupt cookie
    }
  }, []);

  useEffect(() => {
    setActivePortfolioId((curr) => {
      const exists = portfolios.find((p) => p.id === curr);
      if (exists) return curr;
      return portfolios[0]?.id ?? "";
    });
  }, [portfolios]);

  // Persist portfolio params to cookie
  useEffect(() => {
    const data = {
      portfolios: portfolios.map((p) => ({
        id: p.id,
        name: p.name,
        collapsed: p.collapsed,
        selectedTickers: p.selectedTickers,
        weights: p.weights,
        locked: p.locked,
        autoNormalize: p.autoNormalize,
      })),
      global: {
        initialInvestment,
        monthlyContribution,
        rebalance,
        inflationPct,
        windowMode,
        yearsBack,
        customStart,
        customEnd,
        contribStopYears,
        marginEnabled,
        marginLeverage,
        marginLoanRatePct,
        marginInterestFreq,
        marginRebalance,
        marginRebalanceMode,
        marginMaintenancePct,
      },
    };
    const value = JSON.stringify(data);
    try {
      localStorage.setItem(PA_LS_KEY, value);
    } catch {
      // localStorage full or unavailable — silently skip
    }
  }, [
    portfolios,
    initialInvestment,
    monthlyContribution,
    rebalance,
    inflationPct,
    windowMode,
    yearsBack,
    customStart,
    customEnd,
    contribStopYears,
    marginEnabled,
    marginLeverage,
    marginLoanRatePct,
    marginInterestFreq,
    marginRebalance,
    marginRebalanceMode,
    marginMaintenancePct,
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

  const activePortfolio = portfolios.find((p) => p.id === activePortfolioId) ?? portfolios[0] ?? null;

  const buildSimulationInput = useCallback(
    (p: Portfolio): SimulationInput => ({
      tickers: p.selectedTickers,
      weights: p.selectedTickers.map((t) => p.weights[t] ?? 0),
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
    [initialInvestment, monthlyContribution, rebalance, inflationPct, windowMode, yearsBack, customStart, customEnd, contribStopYears, marginEnabled, marginLeverage, marginLoanRatePct, marginInterestFreq, marginRebalance, marginRebalanceMode, marginMaintenancePct]
  );

  const deferredGlobal = useDeferredValue({
    initialInvestment,
    monthlyContribution,
    rebalance,
    inflationPct,
    windowMode,
    yearsBack,
    customStart,
    customEnd,
    contribStopYears,
    marginEnabled,
    marginLeverage,
    marginLoanRatePct,
    marginInterestFreq,
    marginRebalance,
    marginRebalanceMode,
    marginMaintenancePct,
  });
  const deferredPortfolios = useDeferredValue(portfolios);
  const isPending = deferredPortfolios !== portfolios;

  const results = useMemo<Record<string, BacktestResult | null>>(() => {
    const out: Record<string, BacktestResult | null> = {};
    for (const p of deferredPortfolios) {
      if (p.selectedTickers.length === 0) {
        out[p.id] = null;
        continue;
      }
      const input: SimulationInput = {
        tickers: p.selectedTickers,
        weights: p.selectedTickers.map((t) => p.weights[t] ?? 0),
        initialInvestment: deferredGlobal.initialInvestment,
        monthlyContribution: deferredGlobal.monthlyContribution,
        rebalance: deferredGlobal.rebalance,
        marginEnabled: deferredGlobal.marginEnabled,
        marginLeverage: deferredGlobal.marginLeverage,
        marginLoanRate: deferredGlobal.marginLoanRatePct / 100,
        marginInterestFreq: deferredGlobal.marginInterestFreq,
        marginRebalance: deferredGlobal.marginRebalance,
        marginRebalanceMode: deferredGlobal.marginRebalanceMode,
        marginMaintenancePct: deferredGlobal.marginMaintenancePct,
        inflationPct: deferredGlobal.inflationPct,
        windowMode: deferredGlobal.windowMode,
        yearsBack: deferredGlobal.yearsBack,
        customStart: deferredGlobal.customStart,
        customEnd: deferredGlobal.customEnd,
        contribStopYears: deferredGlobal.contribStopYears,
      };
      out[p.id] = runBacktest(input, allPrices);
    }
    return out;
  }, [deferredPortfolios, deferredGlobal, allPrices]);

  const updatePortfolio = useCallback((id: string, updater: (p: Portfolio) => Portfolio) => {
    setPortfolios((prev) => prev.map((p) => (p.id === id ? updater(p) : p)));
  }, []);

  const toggleTicker = useCallback((id: string, ticker: string) => {
    updatePortfolio(id, (p) => {
      if (p.selectedTickers.includes(ticker)) {
        const nextSel = p.selectedTickers.filter((t) => t !== ticker);
        const nextWeights = { ...p.weights };
        delete nextWeights[ticker];
        const nextLocked = { ...p.locked };
        delete nextLocked[ticker];
        return { ...p, selectedTickers: nextSel, weights: nextWeights, locked: nextLocked };
      }
      const nextSel = [...p.selectedTickers, ticker];
      const nextWeights = { ...p.weights, [ticker]: 0 };
      return { ...p, selectedTickers: nextSel, weights: nextWeights };
    });
  }, [updatePortfolio]);

  const handleWeightChange = useCallback(
    (id: string, ticker: string, value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      updatePortfolio(id, (p) => {
        if (p.autoNormalize) {
          const next = { ...p.weights, [ticker]: clamped };
          const tickers = p.selectedTickers;
          const lockedSum = tickers.reduce((s, t) => s + (p.locked[t] ? (next[t] ?? 0) : 0), 0);
          const unlocked = tickers.filter((t) => !p.locked[t]);
          const targetUnlocked = 100 - lockedSum;
          const currentUnlocked = unlocked.reduce((s, t) => s + (next[t] ?? 0), 0);
          if (unlocked.length === 0) return { ...p, weights: next };
          if (currentUnlocked === 0) {
            const share = targetUnlocked / unlocked.length;
            for (const t of unlocked) next[t] = share;
          } else {
            const scale = targetUnlocked / currentUnlocked;
            for (const t of unlocked) next[t] = (next[t] ?? 0) * scale;
          }
          const rounded: Record<string, number> = {};
          for (const t of tickers) rounded[t] = Math.round((next[t] ?? 0) * 100) / 100;
          return { ...p, weights: rounded };
        }
        return { ...p, weights: { ...p.weights, [ticker]: clamped } };
      });
    },
    [updatePortfolio]
  );

  const toggleLock = useCallback((id: string, ticker: string) => {
    updatePortfolio(id, (p) => ({ ...p, locked: { ...p.locked, [ticker]: !p.locked[ticker] } }));
  }, [updatePortfolio]);

  const applyPreset = useCallback((id: string, presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    updatePortfolio(id, (p) => {
      if (presetKey === "equal-weight") {
        const tickers = p.selectedTickers.length > 0 ? p.selectedTickers : Object.keys(PRESETS["golden"]);
        const share = 100 / tickers.length;
        const newWeights: Record<string, number> = {};
        for (const t of tickers) newWeights[t] = Math.round(share * 100) / 100;
        const sum = Object.values(newWeights).reduce((s, w) => s + w, 0);
        if (sum !== 100 && tickers.length > 0) newWeights[tickers[0]] += 100 - sum;
        return { ...p, selectedTickers: tickers, weights: newWeights };
      }
      const tickers = Object.keys(preset);
      return { ...p, selectedTickers: tickers, weights: { ...preset } };
    });
    if (presetKey === "golden-2x") {
      setMarginEnabled(true); setMarginLeverage(2); setMarginLoanRatePct(4);
    } else if (presetKey === "golden-3x") {
      setMarginEnabled(true); setMarginLeverage(3); setMarginLoanRatePct(4);
    } else if (presetKey === "nasdaq-2x") {
      setMarginEnabled(false); setMarginLeverage(1); setMarginLoanRatePct(5);
    }
  }, [updatePortfolio]);

  const runOptimizer = useCallback(
    (id: string, goal: OptimizeGoal) => {
      const portfolio = portfolios.find((p) => p.id === id);
      if (!portfolio || portfolio.selectedTickers.length < 2) return;
      const simInput = buildSimulationInput(portfolio);
      updatePortfolio(id, (p) => ({ ...p, optimizing: goal, optProgress: 0 }));
      setTimeout(() => {
        const res = optimizePortfolio(simInput, allPrices, goal, (prog) => {
          updatePortfolio(id, (p) => ({ ...p, optProgress: prog }));
        });
        if (res) {
          const newWeights: Record<string, number> = {};
          for (let i = 0; i < portfolio.selectedTickers.length; i++) {
            newWeights[portfolio.selectedTickers[i]] = res.weights[i] ?? 0;
          }
          updatePortfolio(id, (p) => ({ ...p, weights: newWeights, optimizing: null, optProgress: 0 }));
        } else {
          updatePortfolio(id, (p) => ({ ...p, optimizing: null, optProgress: 0 }));
        }
      }, 50);
    },
    [portfolios, allPrices, buildSimulationInput, updatePortfolio]
  );

  const addPortfolio = useCallback(() => {
    setPortfolios((prev) => {
      const n = prev.length + 1;
      const name = t("alloc.portfolio.defaultName").replace("{n}", String(n));
      const p = makeDefaultPortfolio(name);
      return [...prev, p];
    });
  }, [t]);

  const deletePortfolio = useCallback((id: string) => {
    setPortfolios((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const renamePortfolio = useCallback((id: string, name: string) => {
    updatePortfolio(id, (p) => ({ ...p, name }));
  }, [updatePortfolio]);

  const toggleCollapsePortfolio = useCallback((id: string) => {
    updatePortfolio(id, (p) => ({ ...p, collapsed: !p.collapsed }));
  }, [updatePortfolio]);

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
    setPortfolios((prev) =>
      prev.map((p) => {
        if (!p.selectedTickers.includes(ticker)) return p;
        const nextSel = p.selectedTickers.filter((t) => t !== ticker);
        const nextWeights = { ...p.weights };
        delete nextWeights[ticker];
        const nextLocked = { ...p.locked };
        delete nextLocked[ticker];
        return { ...p, selectedTickers: nextSel, weights: nextWeights, locked: nextLocked };
      })
    );
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

  const activeResult = activePortfolio ? (results[activePortfolio.id] ?? null) : null;

  const activePortfolioChartData = useMemo(() => {
    if (!activeResult) return [];
    return activeResult.portfolioValue.map((v, i) => ({
      month: activeResult.months[i],
      value: v,
      equity: activeResult.equityValue[i],
      equityReal: activeResult.equityValueReal[i],
      invested: activeResult.invested[i],
      investedReal: activeResult.investedReal[i],
      loan: activeResult.loanAmountSeries[i],
    }));
  }, [activeResult]);

  const activeDrawdownChartData = useMemo(() => {
    if (!activeResult) return [];
    return activeResult.drawdown.map((d, i) => ({
      month: activeResult.months[i],
      drawdown: -(d * 100),
    }));
  }, [activeResult]);

  const activeAllocationChartData = useMemo(() => {
    if (!activePortfolio) return [];
    return activePortfolio.selectedTickers.map((t) => {
      const meta = allTickers.find((x) => x.ticker === t);
      return {
        asset: meta?.name ?? t,
        allocation: activePortfolio.weights[t] ?? 0,
        color: meta?.color ?? "#94a3b8",
      };
    });
  }, [activePortfolio, allTickers]);

  const activeCorrelationMatrix = useMemo(() => {
    if (!activePortfolio || activePortfolio.selectedTickers.length < 2) return null;
    const tickers = activePortfolio.selectedTickers;
    const { months: allMonths, lookups } = intersectPeriod(allPrices, tickers);
    if (allMonths.length < 2) return null;
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
  }, [activePortfolio, allPrices]);

  const activeYearlyChartData = useMemo(() => {
    if (!activeResult) return [];
    const result = activeResult;
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
  }, [activeResult]);

  const activeContributionImpactData = useMemo(() => {
    if (!activeResult) return [];
    const result = activeResult;
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
  }, [activeResult]);

  const performanceOverlayData = useMemo(() => {
    const monthMap = new Map<string, number>();
    for (const p of portfolios) {
      const r = results[p.id];
      if (!r) continue;
      r.months.forEach((m, i) => {
        if (!monthMap.has(m)) monthMap.set(m, monthMap.size);
      });
    }
    const months = Array.from(monthMap.keys()).sort();
    return months.map((m) => {
      const row: Record<string, number | string> = { month: m };
      for (const p of portfolios) {
        const r = results[p.id];
        if (!r) continue;
        const idx = r.months.indexOf(m);
        if (idx >= 0) row[p.id] = r.equityValue[idx];
      }
      return row;
    });
  }, [portfolios, results]);

  const drawdownOverlayData = useMemo(() => {
    const monthsSet = new Set<string>();
    for (const p of portfolios) {
      const r = results[p.id];
      if (!r) continue;
      r.months.forEach((m) => monthsSet.add(m));
    }
    const months = Array.from(monthsSet).sort();
    return months.map((m) => {
      const row: Record<string, number | string> = { month: m };
      for (const p of portfolios) {
        const r = results[p.id];
        if (!r) continue;
        const idx = r.months.indexOf(m);
        if (idx >= 0) row[p.id] = -(r.drawdown[idx] * 100);
      }
      return row;
    });
  }, [portfolios, results]);

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

  const CustomTooltip = ({ active, payload, label, unit = "eur" }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color?: string; name?: string }>; label?: string; unit?: "eur" | "pct" }) => {
    if (!active || !payload || payload.length === 0) return null;
    const pfById = new Map(portfolios.map((p) => [p.id, p]));
    const fmt = (v: number) => unit === "pct" ? `${v.toFixed(1)} %` : formatEUR(v, lang);
    return (
      <div className="rounded-tremor-default border border-slate-700 bg-slate-900/95 p-2 shadow-tremor-card">
        <Text className="text-tremor-content-strong dark:text-slate-100 text-xs font-semibold">
          {label}
        </Text>
        {payload.map((p, i) => {
          const pf = pfById.get(p.dataKey);
          if (pf) {
            return (
              <div key={i} className="text-tremor-content dark:text-slate-200 text-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="font-medium">{pf.name}:</span>
                <span>{fmt(p.value)}</span>
              </div>
            );
          }
          return (
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
          );
        })}
      </div>
    );
  };

  const pfWeightArray = (p: Portfolio) => p.selectedTickers.map((tk) => p.weights[tk] ?? 0);
  const pfTotalWeight = (p: Portfolio) => pfWeightArray(p).reduce((s, w) => s + w, 0);
  const pfIsBalanced = (p: Portfolio) => Math.abs(pfTotalWeight(p) - 100) < 0.01;
  const loanPreview = marginEnabled ? initialInvestment * (marginLeverage - 1) : 0;

  const PF_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c", "#4ade80"];

  return (
    <div className="dark space-y-6">
      {/* Info banners (active portfolio) */}
      {activePortfolio && activeResult && (() => {
        const p = activePortfolio;
        const tw = pfTotalWeight(p);
        const balanced = pfIsBalanced(p);
        const r = activeResult;
        return (
          <>
            {!balanced && p.selectedTickers.length > 0 && (
              <Callout title={t("alloc.callout.unbalanced.title")} color="amber" className="border-amber-800 bg-amber-950/40">
                <Text className="text-amber-300">
                  {t("alloc.callout.unbalanced.body", { total: formatPct(tw, 2, lang) })}
                </Text>
              </Callout>
            )}
            <Callout title={t("alloc.callout.period.title")} color="emerald" className="border-emerald-800 bg-emerald-950/40">
              <Text className="text-emerald-300">
                {t("alloc.callout.period.body", {
                  start: r.startMonth,
                  end: r.endMonth,
                  months: String(r.months.length),
                  name: r.limitingTickerName,
                  ticker: r.limitingTicker,
                  endLimiter: r.limitingEndTicker && r.limitingEndTicker !== r.limitingTicker
                    ? `, fin limitée par ${r.limitingEndTickerName} (${r.limitingEndTicker})`
                    : "",
                })}
              </Text>
            </Callout>
            {r.marginEnabled && (
              <Callout title={t("alloc.callout.margin.title", { leverage: r.marginLeverage.toFixed(2) })} color="amber" className="border-amber-800 bg-amber-950/40">
                <Text className="text-amber-300">
                  {t("alloc.callout.margin.body", { loan: formatEUR(r.loanAmount, lang), rate: formatPct(marginLoanRatePct, 2, lang), freq: marginInterestFreq === "monthly" ? t("alloc.callout.margin.freqMonthly") : t("alloc.callout.margin.freqYearly"), interest: formatEUR(r.totalInterestPaid, lang) })}
                </Text>
              </Callout>
            )}
            {r.liquidationMonth && (
              <Callout title={t("alloc.callout.liquidation.title")} color="rose" className="border-rose-800 bg-rose-950/40">
                <Text className="text-rose-300">
                  {t("alloc.callout.liquidation.body", { month: r.liquidationMonth })}
                </Text>
              </Callout>
            )}
          </>
        );
      })()}

      <Grid numItems={1} numItemsMd={2} className="gap-6">
        {/* ─── Left column ─── */}
        <Col className="space-y-6">
          {/* Ticker picker (global asset universe — targets active portfolio) */}
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-3">{t("alloc.col.assets.title")}</Title>

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
                    {list.map((tk) => {
                      const isSelected = activePortfolio ? activePortfolio.selectedTickers.includes(tk.ticker) : false;
                      const isCustom = customTickers[tk.ticker] !== undefined;
  return (
                        <button
                          key={tk.ticker}
                          type="button"
                          onClick={() => activePortfolio && toggleTicker(activePortfolio.id, tk.ticker)}
                          className={`flex items-center gap-2 rounded-tremor-default border px-2.5 py-2 text-left transition-colors ${
                            isSelected
                              ? "border-emerald-500/50 bg-emerald-500/10"
                              : "border-slate-700 bg-slate-800/50 hover:bg-slate-800"
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tk.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <Text className={`text-sm font-medium truncate ${isSelected ? "text-emerald-300" : "text-slate-300"}`}>
                                {tk.ticker}
                              </Text>
                              {isCustom && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700 text-slate-400 shrink-0">
                                  Custom
                                </span>
                              )}
                            </div>
                            <Text className="text-xs text-slate-500 truncate">{tk.name}</Text>
                          </div>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCustomTicker(tk.ticker);
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

          {/* Portfolio list */}
          {portfolios.map((pf, idx) => {
            const pfTw = pfTotalWeight(pf);
            const pfBal = pfIsBalanced(pf);
            const color = PF_COLORS[idx % PF_COLORS.length];
            return (
            <Card key={pf.id} className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
              {/* Header: name, active badge, collapse, delete */}
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <input
                  type="text"
                  value={pf.name}
                  onChange={(e) => renamePortfolio(pf.id, e.target.value)}
                  className="flex-1 min-w-0 bg-transparent border-b border-transparent focus:border-emerald-500/50 px-1 py-0.5 text-tremor-content-strong dark:text-slate-100 font-medium text-sm focus:outline-none"
                />
                {pf.id === activePortfolioId && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">{t("alloc.portfolio.active")}</span>
                )}
                {pf.id !== activePortfolioId && (
                  <button
                    type="button"
                    onClick={() => setActivePortfolioId(pf.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors shrink-0"
                    title={t("alloc.portfolio.setActive")}
                  >
                    {t("alloc.portfolio.active")}
                  </button>
                )}
                <Button size="xs" variant="secondary" onClick={() => toggleCollapsePortfolio(pf.id)} className="bg-slate-800 text-slate-400 hover:text-slate-200 shrink-0">
                  {pf.collapsed ? t("alloc.portfolio.expand") : t("alloc.portfolio.collapse")}
                </Button>
                {portfolios.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deletePortfolio(pf.id)}
                    className="shrink-0 text-slate-500 hover:text-rose-400 transition-colors"
                    title={t("alloc.portfolio.delete")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" /><path d="M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>

              {!pf.collapsed && (
                <>
                  {/* Quick apply dropdowns: preset / optimize */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    <div>
                      <Text className="text-tremor-content dark:text-slate-500 text-[10px] uppercase tracking-wider mb-1">{t("alloc.portfolio.apply.preset")}</Text>
                      <Select value="" onValueChange={(v) => { if (v) applyPreset(pf.id, v); }} className="bg-slate-900 border-slate-800 text-slate-200 text-sm">
                        <SelectItem value="">—</SelectItem>
                        <SelectItem value="golden">{t("alloc.preset.golden")}</SelectItem>
                        <SelectItem value="60/40">{t("alloc.preset.6040")}</SelectItem>
                        <SelectItem value="all-weather">{t("alloc.preset.allWeather")}</SelectItem>
                        <SelectItem value="equal-weight">{t("alloc.preset.equalWeight")}</SelectItem>
                        <SelectItem value="aggressive">{t("alloc.preset.aggressive")}</SelectItem>
                        <SelectItem value="golden-2x">{t("alloc.preset.golden2x")}</SelectItem>
                        <SelectItem value="golden-3x">{t("alloc.preset.golden3x")}</SelectItem>
                        <SelectItem value="nasdaq-2x">{t("alloc.preset.nasdaq2x")}</SelectItem>
                      </Select>
                    </div>
                    <div>
                      <Text className="text-tremor-content dark:text-slate-500 text-[10px] uppercase tracking-wider mb-1">{t("alloc.portfolio.apply.optimize")}</Text>
                      <Select
                        value={pf.optimizing ?? ""}
                        onValueChange={(v) => { if (v) runOptimizer(pf.id, v as OptimizeGoal); }}
                        className="bg-slate-900 border-slate-800 text-slate-200 text-sm"
                      >
                        <SelectItem value="">—</SelectItem>
                        <SelectItem value="cagr">{t("alloc.optimize.cagr")}</SelectItem>
                        <SelectItem value="sharpe">{t("alloc.optimize.sharpe")}</SelectItem>
                        <SelectItem value="minVol">{t("alloc.optimize.minVol")}</SelectItem>
                        <SelectItem value="calmar">{t("alloc.optimize.calmar")}</SelectItem>
                        <SelectItem value="riskParity">{t("alloc.optimize.riskParity")}</SelectItem>
                        <SelectItem value="blackLitterman">{t("alloc.optimize.blackLitterman")}</SelectItem>
                      </Select>
                    </div>
                  </div>

                  {/* Inline asset picker for this portfolio */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <Text className="text-tremor-content dark:text-slate-500 text-[10px] uppercase tracking-wider">{t("alloc.portfolio.apply.assets")}</Text>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{pf.selectedTickers.length}</span>
                        {pf.optimizing && (
                          <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        )}
                      </div>
                    </div>
                    <div className="rounded-tremor-default bg-slate-900/40 border border-slate-800 p-2 max-h-[220px] overflow-y-auto">
                      {Object.entries(filteredGroups).map(([cls, list]) => {
                        const visible = list.filter((tk) => pf.selectedTickers.includes(tk.ticker) || true);
                        if (visible.length === 0) return null;
                        return (
                          <div key={cls} className="mb-2 last:mb-0">
                            <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                              {t(CLASS_KEYS[cls] ?? `alloc.classLabel.${cls}`)}
                            </Text>
                            <Grid numItems={2} numItemsSm={3} className="gap-1.5">
                              {visible.map((tk) => {
                                const sel = pf.selectedTickers.includes(tk.ticker);
                                return (
                                  <button
                                    key={tk.ticker}
                                    type="button"
                                    onClick={() => toggleTicker(pf.id, tk.ticker)}
                                    className={`flex items-center gap-1.5 rounded-tremor-small border px-2 py-1.5 text-left transition-colors ${
                                      sel
                                        ? "border-emerald-500/50 bg-emerald-500/10"
                                        : "border-slate-700 bg-slate-800/40 hover:bg-slate-800"
                                    }`}
                                  >
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tk.color }} />
                                    <Text className={`text-xs font-medium truncate ${sel ? "text-emerald-300" : "text-slate-300"}`}>
                                      {tk.ticker}
                                    </Text>
                                  </button>
                                );
                              })}
                            </Grid>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Weight sliders */}
                  {pf.selectedTickers.length === 0 ? (
                    <Text className="text-slate-500 text-xs py-3">{t("alloc.portfolio.empty")}</Text>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-3">
                        <Badge color={pfBal ? "emerald" : "amber"} className={pfBal ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}>
                          {t("alloc.col.weights.total", { total: formatPct(pfTw, 2, lang) })} {pfBal ? "" : t("alloc.col.weights.autoNormalized")}
                        </Badge>
                        <Button
                          size="xs"
                          variant={pf.autoNormalize ? "primary" : "secondary"}
                          onClick={() => updatePortfolio(pf.id, (p) => ({ ...p, autoNormalize: !p.autoNormalize }))}
                          className={pf.autoNormalize ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}
                        >
                          {t("alloc.col.weights.autoNormalize")} : {pf.autoNormalize ? "ON" : "OFF"}
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {pf.selectedTickers.map((ticker) => {
                          const meta = allTickers.find((x) => x.ticker === ticker);
                          const weight = pf.weights[ticker] ?? 0;
                          const isLocked = pf.locked[ticker] ?? false;
                          return (
                            <div key={ticker} className="overflow-hidden">
                              <div className="flex sm:hidden flex-col gap-1.5">
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => toggleLock(pf.id, ticker)} className={`shrink-0 w-6 h-6 rounded-tremor-small flex items-center justify-center border transition-colors ${isLocked ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"}`} title={isLocked ? t("alloc.col.weights.unlock") : t("alloc.col.weights.lock")}>
                                    {isLocked ? (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                    ) : (
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
                                    )}
                                  </button>
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? "#94a3b8" }} />
                                  <Text className="text-tremor-content dark:text-slate-300 text-sm truncate flex-1 min-w-0">{meta?.name ?? ticker}</Text>
                                  <div className="w-20 shrink-0">
                                    <NumberInput value={weight} onValueChange={(v) => handleWeightChange(pf.id, ticker, v ?? 0)} min={0} max={100} step={0.5} disabled={isLocked && pf.autoNormalize} className="bg-slate-900 border-slate-800 text-slate-200" />
                                  </div>
                                </div>
                                <div className="pl-8">
                                  <input type="range" min={0} max={100} step={0.5} value={weight} onChange={(e) => handleWeightChange(pf.id, ticker, Number(e.target.value))} disabled={isLocked && pf.autoNormalize} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed" />
                                </div>
                              </div>
                              <div className="hidden sm:flex items-center gap-2">
                                <button type="button" onClick={() => toggleLock(pf.id, ticker)} className={`shrink-0 w-7 h-7 rounded-tremor-small flex items-center justify-center border transition-colors ${isLocked ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"}`} title={isLocked ? t("alloc.col.weights.unlock") : t("alloc.col.weights.lock")}>
                                  {isLocked ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
                                  )}
                                </button>
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta?.color ?? "#94a3b8" }} />
                                <Text className="text-tremor-content dark:text-slate-300 text-sm w-24 lg:w-32 shrink-0 truncate">{meta?.name ?? ticker}</Text>
                                <div className="flex-1 min-w-0">
                                  <input type="range" min={0} max={100} step={0.5} value={weight} onChange={(e) => handleWeightChange(pf.id, ticker, Number(e.target.value))} disabled={isLocked && pf.autoNormalize} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed" />
                                </div>
                                <div className="w-20 lg:w-24 shrink-0">
                                  <NumberInput value={weight} onValueChange={(v) => handleWeightChange(pf.id, ticker, v ?? 0)} min={0} max={100} step={0.5} disabled={isLocked && pf.autoNormalize} className="bg-slate-900 border-slate-800 text-slate-200" />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>
          );
        })}

          {/* Add portfolio */}
          <Button size="sm" onClick={addPortfolio} className="bg-tremor-brand dark:bg-emerald-600 text-white w-full">
            + {t("alloc.portfolio.add")}
          </Button>

          {/* Global configuration */}
          <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-4">{t("alloc.col.config")}</Title>
            <Grid numItems={1} numItemsSm={2} className="gap-4">
              <Col>
                <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.investment")}</Text>
                <NumberInput value={initialInvestment} onValueChange={(v) => setInitialInvestment(Math.max(0, v ?? 0))} min={0} step={1000} className="bg-slate-900 border-slate-800 text-slate-200" />
              </Col>
              <Col>
                <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.monthly")}</Text>
                <NumberInput value={monthlyContribution} onValueChange={(v) => setMonthlyContribution(Math.max(0, v ?? 0))} min={0} step={50} className="bg-slate-900 border-slate-800 text-slate-200" />
              </Col>
              <Col>
                <LabelWithHelp labelKey="alloc.col.config.contribStop" helpKey="alloc.col.config.contribStop.help">
                  <NumberInput value={contribStopYears} onValueChange={(v) => setContribStopYears(Math.max(0, Math.round(v ?? 0)))} min={0} step={1} className="bg-slate-900 border-slate-800 text-slate-200" />
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
                  <NumberInput value={inflationPct} onValueChange={(v) => setInflationPct(Math.max(0, Math.min(20, v ?? 0)))} min={0} max={20} step={0.1} className="bg-slate-900 border-slate-800 text-slate-200" />
                </LabelWithHelp>
              </Col>
            </Grid>

            {/* Margin loan (global — applies to all portfolios) */}
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
            <Title className="text-tremor-content-strong dark:text-slate-100 mb-4">{t("alloc.compare.title")}</Title>

            {isPending && (
              <div className="flex items-center gap-2 mb-4">
                <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <Text className="text-tremor-content dark:text-slate-400 text-sm">{t("alloc.computing")}</Text>
              </div>
            )}

            {portfolios.every((p) => p.selectedTickers.length === 0) ? (
              <Callout title={t("alloc.callout.noAssets.title")} color="amber" className="border-amber-800 bg-amber-950/40">
                <Text className="text-amber-300">{t("alloc.compare.noPortfolios")}</Text>
              </Callout>
            ) : (
              <>
                {/* Comparison table */}
                <div className="overflow-x-auto rounded-xl border border-slate-800 mb-6">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-900/60">
                        <th className="px-3 py-2 font-semibold text-slate-400 sticky left-0 bg-slate-900/60">{t("alloc.compare.metric")}</th>
                        {portfolios.map((p, i) => (
                          <th key={p.id} className="px-3 py-2 font-semibold text-slate-200 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PF_COLORS[i % PF_COLORS.length] }} />
                              {p.name}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rows: Array<{ key: string; label: string; render: (r: BacktestResult | null) => React.ReactNode }> = [
                          { key: "finalValue", label: t("alloc.metrics.finalValue"), render: (r) => r ? formatEUR(r.finalValue, lang) : "—" },
                          { key: "totalInvested", label: t("alloc.metrics.totalInvested"), render: (r) => r ? formatEUR(r.totalInvested, lang) : "—" },
                          { key: "cagr", label: t("alloc.metrics.cagr"), render: (r) => r ? formatPct(r.cagr * 100, 2, lang) : "—" },
                          { key: "cagrReal", label: t("alloc.metrics.cagrReal"), render: (r) => r && r.inflationPct > 0 ? formatPct(r.realCagr * 100, 2, lang) : null },
                          { key: "volatility", label: t("alloc.metrics.volatility"), render: (r) => r ? formatPct(r.volatility * 100, 2, lang) : "—" },
                          { key: "maxDrawdown", label: t("alloc.metrics.maxDrawdown"), render: (r) => r ? formatPct(r.maxDrawdown * 100, 2, lang) : "—" },
                          { key: "sharpe", label: t("alloc.metrics.sharpe"), render: (r) => r ? r.sharpe.toFixed(2) : "—" },
                          { key: "sortino", label: t("alloc.metrics.sortino"), render: (r) => r ? r.sortino.toFixed(2) : "—" },
                          { key: "finalValueReal", label: t("alloc.metrics.finalValueReal"), render: (r) => r && r.inflationPct > 0 ? formatEUR(r.finalValueReal, lang) : null },
                          { key: "totalInvestedReal", label: t("alloc.metrics.totalInvestedReal"), render: (r) => r && r.inflationPct > 0 ? formatEUR(r.totalInvestedReal, lang) : null },
                          { key: "leverage", label: t("alloc.metrics.leverage"), render: (r) => r && r.marginEnabled ? `${r.marginLeverage.toFixed(2)}×` : null },
                          { key: "loan", label: t("alloc.metrics.loan"), render: (r) => r && r.marginEnabled ? formatEUR(r.loanAmount, lang) : null },
                          { key: "interestPaid", label: t("alloc.metrics.interestPaid"), render: (r) => r && r.marginEnabled ? formatEUR(r.totalInterestPaid, lang) : null },
                        ];
                        return rows.map((row) => {
                          const values = portfolios.map((p) => row.render(results[p.id] ?? null));
                          if (values.every((v) => v === null)) return null;
                          return (
                            <tr key={row.key} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                              <td className="px-3 py-2 font-medium text-slate-300 whitespace-nowrap sticky left-0 bg-slate-900/60">{row.label}</td>
                              {values.map((v, i) => (
                                <td key={i} className="px-3 py-2 tabular-nums text-right text-slate-200 whitespace-nowrap">{v ?? "—"}</td>
                              ))}
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Time window (global) */}
                <div className="mb-4 pt-4 border-t border-slate-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <Title className="text-tremor-content-strong dark:text-slate-100 text-base">{t("alloc.col.config.window.title")}</Title>
                    <div className="flex gap-1">
                      {(["all", "lastN", "custom"] as const).map((m) => (
                        <Button key={m} size="xs" variant={windowMode === m ? "primary" : "secondary"} onClick={() => setWindowMode(m)} className={windowMode === m ? "bg-tremor-brand dark:bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}>
                          {t(`alloc.col.config.window.mode.${m}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {windowMode === "lastN" && (
                    <Col>
                      <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.yearsBack")}</Text>
                      <NumberInput value={yearsBack} onValueChange={(v) => setYearsBack(Math.max(1, Math.min(50, Math.round(v ?? 1))))} min={1} max={50} step={1} className="bg-slate-900 border-slate-800 text-slate-200" />
                    </Col>
                  )}
                  {windowMode === "custom" && (
                    <Grid numItems={1} numItemsSm={2} className="gap-4">
                      <Col>
                        <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.start")}</Text>
                        <input type="date" value={customStart ? customStart + "-01" : ""} onChange={(e) => { const v = e.target.value; setCustomStart(v ? v.slice(0, 7) : ""); }} className="bg-slate-900 border border-slate-800 text-slate-200 rounded-md px-3 py-2 w-full text-sm" />
                      </Col>
                      <Col>
                        <Text className="text-tremor-content dark:text-slate-400 text-xs mb-1">{t("alloc.col.config.window.end")}</Text>
                        <input type="date" value={customEnd ? customEnd + "-01" : ""} onChange={(e) => { const v = e.target.value; setCustomEnd(v ? v.slice(0, 7) : ""); }} className="bg-slate-900 border border-slate-800 text-slate-200 rounded-md px-3 py-2 w-full text-sm" />
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
                    {/* Performance overlay + active detail */}
                    <TabPanel>
                      <div className="mt-4 space-y-6">
                        <div>
                          <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.portfolioEvolution")}</Text>
                          <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={performanceOverlayData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v: number) => formatCompactEUR(v, lang)} width={80} />
                              <Tooltip content={<CustomTooltip />} />
                              {portfolios.map((p, i) => {
                                const c = PF_COLORS[i % PF_COLORS.length];
                                return (
                                  <Area key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={c} fill={c} fillOpacity={0.06} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: c }} />
                                );
                              })}
                            </ComposedChart>
                          </ResponsiveContainer>
                          <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
                            {portfolios.map((p, i) => (
                              <div key={p.id} className="flex items-center gap-1.5">
                                <span className="w-3 h-1 rounded-full" style={{ backgroundColor: PF_COLORS[i % PF_COLORS.length] }} />
                                <Text className="text-tremor-content dark:text-slate-400 text-xs">{p.name}</Text>
                              </div>
                            ))}
                          </div>
                        </div>

                        {activeResult && activePortfolio && activePortfolioChartData.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <Text className="text-tremor-content dark:text-slate-400 text-sm">
                                {t("alloc.chart.detailActive", { name: activePortfolio.name })}
                              </Text>
                              <Select value={activePortfolioId} onValueChange={(v) => setActivePortfolioId(v)} className="bg-slate-900 border-slate-800 text-slate-200 text-xs max-w-[180px]">
                                {portfolios.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </Select>
                            </div>
                            <ResponsiveContainer width="100%" height={320}>
                              <ComposedChart data={activePortfolioChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
                                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v: number) => formatCompactEUR(v, lang)} width={80} />
                                <Tooltip content={<CustomTooltip />} />
                                <defs>
                                  <linearGradient id="gradValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                                  </linearGradient>
                                  <linearGradient id="gradInvested" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#64748b" stopOpacity={0.18} />
                                    <stop offset="100%" stopColor="#64748b" stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey="value" name={t("alloc.chart.value")} stroke="#10b981" fill="url(#gradValue)" strokeWidth={1.5} dot={false} />
                                <Area type="monotone" dataKey="invested" name={t("alloc.chart.invested")} stroke="#64748b" fill="url(#gradInvested)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                                {activeResult.marginEnabled && (
                                  <Area type="monotone" dataKey="loan" name={t("alloc.chart.loan")} stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.04} strokeWidth={1.5} dot={false} />
                                )}
                                <Line type="monotone" dataKey="equity" name={t("alloc.chart.equity")} stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                                {inflationPct > 0 && (
                                  <Line type="monotone" dataKey="equityReal" name={`${t("alloc.chart.equity")} (${t("alloc.real.suffix")})`} stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="5 4" />
                                )}
                                {inflationPct > 0 && (
                                  <Line type="monotone" dataKey="investedReal" name={`${t("alloc.chart.invested")} (${t("alloc.real.suffix")})`} stroke="#94a3b8" strokeWidth={1} dot={false} strokeDasharray="2 3" />
                                )}
                              </ComposedChart>
                            </ResponsiveContainer>
                            <div className="flex items-center gap-4 mt-2 justify-center flex-wrap text-xs text-slate-400">
                              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-emerald-500" />{t("alloc.chart.value")}</span>
                              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-sky-400" />{t("alloc.chart.equity")}</span>
                              <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-slate-500" />{t("alloc.chart.invested")}</span>
                              {inflationPct > 0 && <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-violet-400" />{t("alloc.real.suffix")}</span>}
                              {activeResult.marginEnabled && <span className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full bg-rose-500" />{t("alloc.chart.loan")}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </TabPanel>

                    {/* Drawdown overlay */}
                    <TabPanel>
                      <div className="mt-4">
                        <Text className="text-tremor-content dark:text-slate-400 text-sm mb-2">{t("alloc.chart.drawdownOverTime")}</Text>
                        <ResponsiveContainer width="100%" height={340}>
                          <ComposedChart data={drawdownOverlayData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v: number) => `${v.toFixed(1)} %`} width={60} />
                            <Tooltip content={<CustomTooltip unit="pct" />} />
                            {portfolios.map((p, i) => {
                              const c = PF_COLORS[i % PF_COLORS.length];
                              return (
                                <Area key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={c} fill={c} fillOpacity={0.08} strokeWidth={2} dot={false} />
                              );
                            })}
                          </ComposedChart>
                        </ResponsiveContainer>
                        <div className="flex items-center gap-4 mt-2 justify-center flex-wrap">
                          {portfolios.map((p, i) => (
                            <div key={p.id} className="flex items-center gap-1.5">
                              <span className="w-3 h-1 rounded-full" style={{ backgroundColor: PF_COLORS[i % PF_COLORS.length] }} />
                              <Text className="text-tremor-content dark:text-slate-400 text-xs">{p.name}</Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    </TabPanel>

                    {/* Correlation (active portfolio) */}
                    <TabPanel>
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <Text className="text-tremor-content dark:text-slate-400 text-sm">{t("alloc.chart.correlationDesc")}</Text>
                          <Select value={activePortfolioId} onValueChange={(v) => setActivePortfolioId(v)} className="bg-slate-900 border-slate-800 text-slate-200 text-xs max-w-[180px]">
                            {portfolios.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </Select>
                        </div>
                        {activeCorrelationMatrix && activePortfolio ? (
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-center text-xs">
                              <thead>
                                <tr className="border-b border-slate-700 bg-slate-900/60">
                                  <th className="px-2 py-2 font-semibold text-slate-500 sticky left-0 bg-slate-900/60"></th>
                                  {activePortfolio.selectedTickers.map((tk) => {
                                    const meta = allTickers.find((x) => x.ticker === tk);
                                    return <th key={tk} className="px-2 py-2 font-semibold text-slate-300 whitespace-nowrap" title={meta?.name ?? tk}>{meta?.name ?? tk}</th>;
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {activeCorrelationMatrix.map((row, i) => {
                                  const t1 = activePortfolio.selectedTickers[i];
                                  const meta1 = allTickers.find((x) => x.ticker === t1);
                                  return (
                                    <tr key={t1} className="border-b border-slate-800">
                                      <td className="px-2 py-2 font-semibold text-slate-300 whitespace-nowrap sticky left-0 bg-slate-900/60" title={meta1?.name ?? t1}>{meta1?.name ?? t1}</td>
                                      {row.map((v, j) => {
                                        const pct = Math.round(v * 100);
                                        const bg = v >= 0.7 ? `rgba(239,68,68,${0.15 + v * 0.55})` : v >= 0.3 ? `rgba(251,191,36,${0.1 + v * 0.4})` : v <= -0.3 ? `rgba(34,197,94,${0.15 + Math.abs(v) * 0.45})` : "rgba(148,163,184,0.1)";
                                        return <td key={j} className="px-2 py-2 tabular-nums" style={{ background: bg }} title={`${pct}%`}>{pct}%</td>;
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

                    {/* Yearly (active portfolio) */}
                    <TabPanel>
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <Text className="text-tremor-content dark:text-slate-400 text-sm">{t("alloc.chart.yearlyDesc")}</Text>
                          <Select value={activePortfolioId} onValueChange={(v) => setActivePortfolioId(v)} className="bg-slate-900 border-slate-800 text-slate-200 text-xs max-w-[180px]">
                            {portfolios.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </Select>
                        </div>
                        {activeResult ? (
                          <>
                            <ResponsiveContainer width="100%" height={400}>
                              <ComposedChart data={activeYearlyChartData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                                <YAxis tickFormatter={(v: number) => formatCompactEUR(v, lang)} tick={{ fill: "#94a3b8", fontSize: 12 }} width={80} />
                                <Tooltip content={<CustomTooltip />} />
                                <ReferenceLine y={0} stroke="#475569" />
                                <Bar dataKey="invested" name={t("alloc.chart.invested")} fill="#64748b" radius={[2, 2, 0, 0]} stackId="a" />
                                <Bar dataKey="gain" name={t("alloc.chart.gain")} radius={[2, 2, 0, 0]} stackId="a">
                                  {activeYearlyChartData.map((entry, index) => (
                                    <Cell key={`g-${index}`} fill={entry.gain >= 0 ? "#34d399" : "#f87171"} />
                                  ))}
                                </Bar>
                                <Bar dataKey="interest" name={t("alloc.metrics.interestPaid")} fill="#fbbf24" radius={[2, 2, 0, 0]} />
                                <Bar dataKey="equityEnd" name={t("alloc.metrics.finalValue")} fill="#10b981" fillOpacity={0.15} radius={[2, 2, 0, 0]} />
                                {activeResult.inflationPct > 0 && (
                                  <Bar dataKey="equityEndReal" name={t("alloc.metrics.finalValueReal")} fill="#0d9488" fillOpacity={0.15} radius={[2, 2, 0, 0]} />
                                )}
                              </ComposedChart>
                            </ResponsiveContainer>
                            <div className="mt-3 flex flex-wrap gap-3">
                              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-500" /><Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.invested")}</Text></div>
                              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400" /><Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.chart.gain")}</Text></div>
                              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400" /><Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.interestPaid")}</Text></div>
                              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/40" /><Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.finalValue")}</Text></div>
                              {activeResult.inflationPct > 0 && (
                                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-teal-600/40" /><Text className="text-tremor-content dark:text-slate-400 text-xs">{t("alloc.metrics.finalValueReal")}</Text></div>
                              )}
                            </div>
                          </>
                        ) : (
                          <Text className="text-slate-500 text-xs mt-4">{t("alloc.portfolio.empty")}</Text>
                        )}
                      </div>
                    </TabPanel>
                  </TabPanels>
                </TabGroup>

                {/* Contribution impact (active portfolio) */}
                {activeResult && monthlyContribution > 0 && activeContributionImpactData.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-slate-200">{t("alloc.contrib.title")}</h3>
                      <Select value={activePortfolioId} onValueChange={(v) => setActivePortfolioId(v)} className="bg-slate-900 border-slate-800 text-slate-200 text-xs max-w-[180px]">
                        {portfolios.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </Select>
                    </div>
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
                          {activeContributionImpactData.map((row) => {
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
