"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Callout,
  Card,
  Col,
  Grid,
  NumberInput,
  Select,
  SelectItem,
  Text,
  Title,
} from "@tremor/react";
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
/* ─────────────────────────── Icons (inline SVG) ─────────────────────────── */

const PlayIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
  </svg>
);

const SparklesIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 002.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);

import { I18nProvider, useI18n } from "../i18n/I18nProvider";

/* ─────────────────────────── Types ─────────────────────────── */

interface SimulationParams {
  initial: number;
  monthly: number;
  monthlyReturn: number;
  monthlyVolatility: number;
  months: number;
  targetDrawdown: number;
  forceDrawdown: boolean;
  stopMonthlyAtMonth: number;
}

interface SimulationResult {
  yearlyValues: number[];
  investedYearly: number[];
  portfolioDrawdownYearly: number[];
  monthlyValues: number[];
  monthlyInvested: number[];
  monthlyDrawdown: number[];
  finalValue: number;
  peakValue: number;
  portfolioMaxDrawdown: number;
  marketMaxDrawdown: number;
}

interface YearSeries {
  years: number[];
  p10: number[];
  p50: number[];
  p90: number[];
}

interface MonthlySeries {
  p10: number[];
  p50: number[];
  p90: number[];
}

interface SimulationOutput {
  series: YearSeries;
  monthlySeries: MonthlySeries;
  invested: number[];
  currentAge: number;
  target: number;
  inflation: number;
  totalYears: number;
  avgMarketDrawdown: number;
}

interface SingleRunResult {
  yearlyValues: number[];
  monthlyValues: number[];
  monthlyInvested: number[];
  monthlyDrawdown: number[];
  finalValue: number;
  peakValue: number;
  portfolioMaxDrawdown: number;
  marketMaxDrawdown: number;
}

export type PresetKey =
  | "custom"
  | "golden"
  | "golden-2x"
  | "golden-3x"
  | "sp500"
  | "world"
  | "nasdaq-2x"
  | "all-weather";

export const PRESETS: Record<PresetKey, { cagr: number; drawdown: number }> = {
  custom: { cagr: 7, drawdown: 30 },
  golden: { cagr: 8, drawdown: 29 },
  "golden-2x": { cagr: 11.5, drawdown: 40 },
  // 3× Golden Ratio with 4% margin loan rate: 3 × 8% − 2 × 4% = 16% gross,
  // trimmed for volatility drag ≈ 14%. Drawdown roughly tripled, capped ~60%.
  "golden-3x": { cagr: 14, drawdown: 60 },
  sp500: { cagr: 10.76, drawdown: 63 },
  world: { cagr: 8.05, drawdown: 55 },
  // 2× Nasdaq-100 via leveraged ETF (~0.5% internal financing). QQQ CAGR
  // ~15%, 2× leveraged with volatility drag ≈ 22%. Drawdown near 80%.
  "nasdaq-2x": { cagr: 22, drawdown: 80 },
  // All-Weather (Ray Dalio): diversified across equities, long/short bonds,
  // gold, commodities. Low volatility, ~7.5% CAGR, max drawdown ~25%.
  "all-weather": { cagr: 7.5, drawdown: 25 },
};

const EPSILON = 1e-12;
const MONTHLY_CAP = 5000;
const PROBE_PATHS = 300;

const COOKIE_NAME = "ffunds_mc_params";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/* ─────────────────────────── Engine ─────────────────────────── */

function normalRandom(): number {
  const u = Math.max(Math.random(), EPSILON);
  const v = Math.max(Math.random(), EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], target: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (target / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function computeMonthlyVol(maxDrawdown: number, years: number): number {
  const annualVol = maxDrawdown / (Math.sqrt(Math.max(1, years)) * 0.6);
  return Math.max(0.005, annualVol / Math.sqrt(12));
}

function generateReturns(
  monthlyReturn: number,
  monthlyVol: number,
  months: number,
  forceDrawdown: boolean,
  targetDrawdown: number,
): number[] {
  const returns: number[] = new Array(months);
  for (let m = 0; m < months; m++) {
    returns[m] = monthlyReturn + normalRandom() * monthlyVol;
  }
  if (forceDrawdown && targetDrawdown > 0 && months > 12) {
    const crashLen = 3 + Math.floor(Math.random() * 7);
    const earliest = Math.max(3, Math.floor(months * 0.1));
    const latest = Math.max(earliest + 1, Math.floor(months * 0.85) - crashLen);
    const start = earliest + Math.floor(Math.random() * Math.max(1, latest - earliest));
    const perMonth = Math.pow(1 - targetDrawdown, 1 / crashLen) - 1;
    for (let i = 0; i < crashLen && start + i < months; i++) {
      returns[start + i] = perMonth;
    }
  }
  return returns;
}

function simulatePath(params: SimulationParams): SimulationResult {
  const {
    initial,
    monthly,
    monthlyReturn,
    monthlyVolatility,
    months,
    targetDrawdown,
    forceDrawdown,
    stopMonthlyAtMonth,
  } = params;

  const returns = generateReturns(monthlyReturn, monthlyVolatility, months, forceDrawdown, targetDrawdown);

  let value = initial;
  let totalInvested = initial;
  let peak = initial;
  let portfolioMaxDrawdown = 0;

  let marketIndex = initial;
  let marketPeak = initial;
  let marketMaxDrawdown = 0;

  const yearlyValues: number[] = [initial];
  const investedYearly: number[] = [initial];
  const portfolioDrawdownYearly: number[] = [0];
  const monthlyValues: number[] = [initial];
  const monthlyInvested: number[] = [initial];
  const monthlyDrawdown: number[] = [0];

  for (let m = 1; m <= months; m++) {
    const r = returns[m - 1];
    const contribute = stopMonthlyAtMonth <= 0 || m <= stopMonthlyAtMonth;
    const cashflow = contribute ? monthly : 0;
    value = Math.max(0, value * (1 + r) + cashflow);
    totalInvested += cashflow;
    peak = Math.max(peak, value);
    const dd = peak > 0 ? (peak - value) / peak : 0;
    portfolioMaxDrawdown = Math.max(portfolioMaxDrawdown, dd);

    marketIndex = Math.max(0, marketIndex * (1 + r));
    marketPeak = Math.max(marketPeak, marketIndex);
    const mdd = marketPeak > 0 ? (marketPeak - marketIndex) / marketPeak : 0;
    marketMaxDrawdown = Math.max(marketMaxDrawdown, mdd);

    monthlyValues.push(value);
    monthlyInvested.push(totalInvested);
    monthlyDrawdown.push(dd);

    if (m % 12 === 0) {
      yearlyValues.push(value);
      investedYearly.push(totalInvested);
      portfolioDrawdownYearly.push(portfolioMaxDrawdown);
    }
  }

  return {
    yearlyValues,
    investedYearly,
    portfolioDrawdownYearly,
    monthlyValues,
    monthlyInvested,
    monthlyDrawdown,
    finalValue: value,
    peakValue: peak,
    portfolioMaxDrawdown,
    marketMaxDrawdown,
  };
}

function runSimulation(params: SimulationParams, pathCount: number): SimulationOutput | null {
  if (params.months <= 0 || pathCount <= 0) return null;

  const years = Math.ceil(params.months / 12);
  const yearValues: number[][] = Array.from({ length: years + 1 }, () => []);
  const monthValues: number[][] = Array.from({ length: params.months + 1 }, () => []);
  const investedAtYear: number[] = new Array(years + 1).fill(0);
  let drawdownSum = 0;

  // Invested amount is deterministic: initial + monthly contributions up to stopMonthlyAtMonth.
  for (let y = 0; y <= years; y++) {
    const monthsContributing = Math.min(y * 12, params.stopMonthlyAtMonth > 0 ? params.stopMonthlyAtMonth : y * 12);
    investedAtYear[y] = params.initial + params.monthly * monthsContributing;
  }

  const monthlyCap = Math.min(pathCount, MONTHLY_CAP);

  for (let p = 0; p < pathCount; p++) {
    const res = simulatePath(params);
    for (let y = 0; y <= years; y++) {
      if (y < res.yearlyValues.length) yearValues[y].push(res.yearlyValues[y]);
    }
    if (p < monthlyCap) {
      for (let m = 0; m <= params.months; m++) {
        if (m < res.monthlyValues.length) monthValues[m].push(res.monthlyValues[m]);
      }
    }
    drawdownSum += res.marketMaxDrawdown;
  }

  const series: YearSeries = {
    years: [],
    p10: [],
    p50: [],
    p90: [],
  };
  const monthlySeries: MonthlySeries = { p10: [], p50: [], p90: [] };
  const invested: number[] = [];

  for (let y = 0; y <= years; y++) {
    const sorted = yearValues[y].slice().sort((a, b) => a - b);
    series.years.push(params.currentAge + y);
    series.p10.push(percentile(sorted, 10));
    series.p50.push(percentile(sorted, 50));
    series.p90.push(percentile(sorted, 90));
    invested.push(investedAtYear[y] || 0);
  }

  for (let m = 0; m <= params.months; m++) {
    const sorted = monthValues[m].slice().sort((a, b) => a - b);
    monthlySeries.p10.push(percentile(sorted, 10));
    monthlySeries.p50.push(percentile(sorted, 50));
    monthlySeries.p90.push(percentile(sorted, 90));
  }

  return {
    series,
    monthlySeries,
    invested,
    currentAge: params.currentAge,
    target: params.targetDrawdown,
    inflation: 0,
    totalYears: years,
    avgMarketDrawdown: drawdownSum / pathCount,
  };
}

function estimateMedianFinal(params: SimulationParams, paths: number): number {
  const finals: number[] = [];
  for (let p = 0; p < paths; p++) {
    finals.push(simulatePath(params).finalValue);
  }
  finals.sort((a, b) => a - b);
  return percentile(finals, 50);
}

interface OptimizeResult {
  found: boolean;
  tooHigh?: boolean;
  value?: number;
}

function optimizeInitial(
  baseParams: Omit<SimulationParams, "initial">,
  target: number,
): OptimizeResult {
  if (target <= 0) return { found: false };
  let lo = 0;
  let hi = 10_000_000;
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const params = { ...baseParams, initial: mid } as SimulationParams;
    const median = estimateMedianFinal(params, PROBE_PATHS);
    if (median >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 50) break;
  }
  if (hi >= 10_000_000 - 1) {
    const median = estimateMedianFinal({ ...baseParams, initial: hi } as SimulationParams, PROBE_PATHS);
    if (median < target) return { found: false, tooHigh: true };
  }
  return { found: true, value: Math.ceil(hi / 100) * 100 };
}

function optimizeMonthly(
  baseParams: Omit<SimulationParams, "monthly">,
  target: number,
): OptimizeResult {
  if (target <= 0) return { found: false };
  let lo = 0;
  let hi = 50_000;
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const params = { ...baseParams, monthly: mid } as SimulationParams;
    const median = estimateMedianFinal(params, PROBE_PATHS);
    if (median >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
    if (hi - lo < 1) break;
  }
  if (hi >= 50_000 - 1) {
    const median = estimateMedianFinal({ ...baseParams, monthly: hi } as SimulationParams, PROBE_PATHS);
    if (median < target) return { found: false, tooHigh: true };
  }
  return { found: true, value: Math.ceil(hi) };
}

function runSingleSimulation(params: SimulationParams): SingleRunResult {
  const res = simulatePath(params);
  return {
    yearlyValues: res.yearlyValues,
    monthlyValues: res.monthlyValues,
    monthlyInvested: res.monthlyInvested,
    monthlyDrawdown: res.monthlyDrawdown,
    finalValue: res.finalValue,
    peakValue: res.peakValue,
    portfolioMaxDrawdown: res.portfolioMaxDrawdown,
    marketMaxDrawdown: res.marketMaxDrawdown,
  };
}

/* ─────────────────────────── Cookie ─────────────────────────── */

interface CookieData {
  preset: PresetKey;
  currentAge: number;
  retirementAge: number;
  stopAge: number;
  initial: number;
  monthly: number;
  cagr: number;
  inflation: number;
  drawdown: number;
  target: number;
  paths: number;
  forceDrawdown: boolean;
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string, maxAge: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

/* ─────────────────────────── Component ─────────────────────────── */

function MonteCarloSimulatorInner(): JSX.Element {
  const { lang, t } = useI18n();

  const [preset, setPreset] = useState<PresetKey>("golden");
  const [currentAge, setCurrentAge] = useState(40);
  const [retirementAge, setRetirementAge] = useState(65);
  const [stopAge, setStopAge] = useState(60);
  const [initial, setInitial] = useState(10000);
  const [monthly, setMonthly] = useState(300);
  const [cagr, setCagr] = useState(8);
  const [inflation, setInflation] = useState(2.5);
  const [drawdown, setDrawdown] = useState(29);
  const [target, setTarget] = useState(0);
  const [paths, setPaths] = useState(1000);
  const [forceDrawdown, setForceDrawdown] = useState(true);

  const [simResult, setSimResult] = useState<SimulationOutput | null>(null);
  const [singleResult, setSingleResult] = useState<SingleRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optMessage, setOptMessage] = useState<{ kind: "ok" | "needTarget" | "tooHigh"; value?: number; variable?: "initial" | "monthly" } | null>(null);

  const simVersionRef = useRef(0);

  const years = Math.max(1, retirementAge - currentAge);
  const months = years * 12;
  const stopAgeClamped = Math.min(retirementAge, Math.max(currentAge, stopAge));
  const stopMonthlyAtMonth = stopAgeClamped < retirementAge ? (stopAgeClamped - currentAge) * 12 : 0;
  const monthlyReturn = cagr / 100 / 12;
  const monthlyVolatility = useMemo(() => computeMonthlyVol(drawdown / 100, years), [drawdown, years]);

  const params: SimulationParams = useMemo(
    () => ({
      initial,
      monthly,
      monthlyReturn,
      monthlyVolatility,
      months,
      targetDrawdown: drawdown / 100,
      forceDrawdown,
      stopMonthlyAtMonth,
      currentAge,
    }),
    [initial, monthly, monthlyReturn, monthlyVolatility, months, drawdown, forceDrawdown, stopMonthlyAtMonth, currentAge],
  );

  /* Load from cookie on mount */
  useEffect(() => {
    try {
      const raw = readCookie(COOKIE_NAME);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<CookieData>;
      if (data.preset) setPreset(data.preset);
      if (typeof data.currentAge === "number") setCurrentAge(data.currentAge);
      if (typeof data.retirementAge === "number") setRetirementAge(data.retirementAge);
      if (typeof data.stopAge === "number") setStopAge(data.stopAge);
      if (typeof data.initial === "number") setInitial(data.initial);
      if (typeof data.monthly === "number") setMonthly(data.monthly);
      if (typeof data.cagr === "number") setCagr(data.cagr);
      if (typeof data.inflation === "number") setInflation(data.inflation);
      if (typeof data.drawdown === "number") setDrawdown(data.drawdown);
      if (typeof data.target === "number") setTarget(data.target);
      if (typeof data.paths === "number") setPaths(data.paths);
      if (typeof data.forceDrawdown === "boolean") setForceDrawdown(data.forceDrawdown);
    } catch {}
  }, []);

  /* Persist to cookie */
  useEffect(() => {
    const data: CookieData = {
      preset,
      currentAge,
      retirementAge,
      stopAge,
      initial,
      monthly,
      cagr,
      inflation,
      drawdown,
      target,
      paths,
      forceDrawdown,
    };
    writeCookie(COOKIE_NAME, JSON.stringify(data), COOKIE_MAX_AGE);
  }, [preset, currentAge, retirementAge, stopAge, initial, monthly, cagr, inflation, drawdown, target, paths, forceDrawdown]);

  /* Auto-run simulation on mount and when key params change */
  const runSim = useCallback(() => {
    const version = ++simVersionRef.current;
    setRunning(true);
    setOptMessage(null);
    setTimeout(() => {
      if (version !== simVersionRef.current) return;
      const result = runSimulation(params, paths);
      if (version !== simVersionRef.current) return;
      setSimResult(result);
      setRunning(false);
      if (result) {
        const single = runSingleSimulation(params);
        setSingleResult(single);
      }
    }, 50);
  }, [params, paths]);

  useEffect(() => {
    runSim();
  }, [runSim]);

  const applyPreset = useCallback((key: PresetKey) => {
    setPreset(key);
    const p = PRESETS[key];
    if (key !== "custom") {
      setCagr(p.cagr);
      setDrawdown(p.drawdown);
    }
  }, []);

  const handleOptimize = useCallback(
    (variable: "initial" | "monthly") => {
      if (target <= 0) {
        setOptMessage({ kind: "needTarget", variable });
        return;
      }
      const version = ++simVersionRef.current;
      setOptimizing(true);
      setOptMessage(null);
      setTimeout(() => {
        if (version !== simVersionRef.current) return;
        const baseParams = {
          monthly: variable === "initial" ? monthly : 0,
          initial: variable === "monthly" ? initial : 0,
          monthlyReturn,
          monthlyVolatility,
          months,
          targetDrawdown: drawdown / 100,
          forceDrawdown,
          stopMonthlyAtMonth,
          currentAge,
        };
        const result = variable === "initial"
          ? optimizeInitial({ ...baseParams, monthly }, target)
          : optimizeMonthly({ ...baseParams, initial }, target);
        if (version !== simVersionRef.current) return;
        if (result.found && result.value !== undefined) {
          if (variable === "initial") setInitial(result.value);
          else setMonthly(result.value);
          setOptMessage({ kind: "ok", value: result.value, variable });
        } else if (result.tooHigh) {
          setOptMessage({ kind: "tooHigh", variable });
        }
        setOptimizing(false);
      }, 50);
    },
    [target, monthly, initial, monthlyReturn, monthlyVolatility, months, drawdown, forceDrawdown, stopMonthlyAtMonth, currentAge],
  );

  const handleSingleRun = useCallback(() => {
    const single = runSingleSimulation(params);
    setSingleResult(single);
  }, [params]);

  /* Formatters */
  const eurFmt = useMemo(
    () => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
    [lang],
  );
  const eurCompact = useMemo(
    () => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { notation: "compact", maximumFractionDigits: 1, style: "currency", currency: "EUR" }),
    [lang],
  );
  const pctFmt = useMemo(
    () => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 1 }),
    [lang],
  );

  const fmtEUR = (v: number) => eurFmt.format(Math.round(v));
  const fmtCompact = (v: number) => eurCompact.format(v);
  const fmtPct = (v: number) => `${pctFmt.format(v)}%`;

  /* Chart data */
  const chartData = useMemo(() => {
    if (!simResult) return [];
    const inflFrac = inflation / 100;
    return simResult.series.years.map((yr, i) => {
      const yearsFromNow = Math.max(0, yr - simResult.currentAge);
      const realFactor = inflFrac > 0 ? 1 / Math.pow(1 + inflFrac, yearsFromNow) : 1;
      return {
        year: yr,
        p10: simResult.series.p10[i],
        p50: simResult.series.p50[i],
        p90: simResult.series.p90[i],
        p10r: simResult.series.p10[i] * realFactor,
        p50r: simResult.series.p50[i] * realFactor,
        p90r: simResult.series.p90[i] * realFactor,
        bandMin: simResult.series.p10[i],
        bandMax: simResult.series.p90[i],
        invested: simResult.invested[i] || 0,
        target: target > 0 ? target : undefined,
      };
    });
  }, [simResult, target, inflation]);

  const singleChartData = useMemo(() => {
    if (!singleResult) return [];
    return singleResult.yearlyValues.map((v, i) => ({
      year: currentAge + i,
      value: v,
      invested: singleResult.monthlyInvested[Math.min(i * 12, singleResult.monthlyInvested.length - 1)] || 0,
    }));
  }, [singleResult, currentAge]);

  const inflationFactor = useMemo(() => {
    if (!simResult || inflation <= 0) return 1;
    return 1 / Math.pow(1 + inflation / 100, simResult.totalYears);
  }, [simResult, inflation]);

  /* Custom tooltip */
  const tooltipContent = useCallback(
    (active: boolean, payload: any[], label: any) => {
      if (!active || !payload || payload.length === 0) return null;
      const yr = label;
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl text-xs">
          <p className="font-semibold text-slate-200 mb-1">{t("mc.tooltip.age")}: {yr}</p>
          {payload.map((entry, idx) => {
            const key = entry.dataKey;
            let label2 = "";
            let val = "";
            let color = entry.color || "#94a3b8";
            if (key === "p50") { label2 = t("mc.tooltip.median"); color = "#10b981"; val = fmtEUR(entry.value); }
            else if (key === "p10") { label2 = t("mc.tooltip.pessimistic"); color = "#f43f5e"; val = fmtEUR(entry.value); }
            else if (key === "p90") { label2 = t("mc.tooltip.optimistic"); color = "#3b82f6"; val = fmtEUR(entry.value); }
            else if (key === "invested") { label2 = t("mc.tooltip.invested"); color = "#64748b"; val = fmtEUR(entry.value); }
            else if (key === "target") { label2 = t("mc.tooltip.target"); color = "#f59e0b"; val = fmtEUR(entry.value); }
            else if (key === "p50r") { label2 = `${t("mc.tooltip.median")} (${t("mc.result.realSuffix")})`; color = "#10b981"; val = fmtEUR(entry.value); }
            else if (key === "p10r") { label2 = `${t("mc.tooltip.pessimistic")} (${t("mc.result.realSuffix")})`; color = "#f43f5e"; val = fmtEUR(entry.value); }
            else if (key === "p90r") { label2 = `${t("mc.tooltip.optimistic")} (${t("mc.result.realSuffix")})`; color = "#3b82f6"; val = fmtEUR(entry.value); }
            else if (key === "value") { label2 = t("mc.tooltip.value"); color = "#10b981"; val = fmtEUR(entry.value); }
            if (!label2) return null;
            return (
              <p key={idx} style={{ color }} className="flex items-center gap-1.5">
                <span className="font-medium">{label2}:</span>
                <span className="tabular-nums">{val}</span>
              </p>
            );
          })}
        </div>
      );
    },
    [t, fmtEUR],
  );

  return (
    <div className="space-y-6">
      {/* Configuration card */}
      <Card className={`bg-tremor-background dark:bg-slate-900/60 border-tremor-border border ${running ? "animate-pulse" : ""}`}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <Title className="text-slate-100">{t("mc.config.title")}</Title>
          {/* Preset pills */}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  preset === key
                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                    : "bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                }`}
              >
                {t(`mc.preset.${key === "golden-2x" ? "golden2x" : key}`)}
              </button>
            ))}
          </div>
        </div>

        <Grid numItems={1} numItemsSm={2} numItemsMd={3} className="gap-4">
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.currentAge")}</label>
            <NumberInput
              value={currentAge}
              onValueChange={(v) => setCurrentAge(Math.max(0, Math.min(99, v || 0)))}
              min={0}
              max={99}
              step={1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.retirementAge")}</label>
            <NumberInput
              value={retirementAge}
              onValueChange={(v) => setRetirementAge(Math.max(currentAge + 1, Math.min(99, v || 1)))}
              min={currentAge + 1}
              max={99}
              step={1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.stopAge")}</label>
            <NumberInput
              value={stopAge}
              onValueChange={(v) => setStopAge(Math.max(currentAge, Math.min(retirementAge, v || 0)))}
              min={currentAge}
              max={retirementAge}
              step={1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.initial")}</label>
            <NumberInput
              value={initial}
              onValueChange={(v) => setInitial(Math.max(0, v || 0))}
              min={0}
              step={100}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.monthly")}</label>
            <NumberInput
              value={monthly}
              onValueChange={(v) => setMonthly(Math.max(0, v || 0))}
              min={0}
              step={10}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.cagr")}</label>
            <NumberInput
              value={cagr}
              onValueChange={(v) => setCagr(Math.max(0, Math.min(50, v || 0)))}
              min={0}
              max={50}
              step={0.1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.inflation")}</label>
            <NumberInput
              value={inflation}
              onValueChange={(v) => setInflation(Math.max(0, Math.min(20, v || 0)))}
              min={0}
              max={20}
              step={0.1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.drawdown")}</label>
            <NumberInput
              value={drawdown}
              onValueChange={(v) => setDrawdown(Math.max(0, Math.min(95, v || 0)))}
              min={0}
              max={95}
              step={1}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.target")}</label>
            <NumberInput
              value={target}
              onValueChange={(v) => setTarget(Math.max(0, v || 0))}
              min={0}
              step={1000}
              className="dark:bg-slate-900/60"
            />
          </Col>
          <Col>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">{t("mc.input.paths")}</label>
            <Select
              value={String(paths)}
              onValueChange={(v) => setPaths(Number(v))}
              className="dark:bg-slate-900/60"
            >
              {[100, 500, 1000, 2000, 5000, 10000].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}
                </SelectItem>
              ))}
            </Select>
          </Col>
          <Col className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={forceDrawdown}
                onChange={(e) => setForceDrawdown(e.target.checked)}
                className="h-4 w-4 rounded accent-emerald-500"
              />
              <span className="leading-tight">{t("mc.input.forceDrawdown")}</span>
            </label>
          </Col>
        </Grid>

        {/* Action bar */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            onClick={runSim}
            color="emerald"
            variant="primary"
            size="sm"
            disabled={running}
          >
            <PlayIcon className="h-4 w-4 mr-1" />
            {running ? t("mc.running") : t("mc.btn.run")}
          </Button>
          <Button
            onClick={() => handleOptimize("initial")}
            color="blue"
            variant="secondary"
            size="sm"
            disabled={optimizing}
          >
            <SparklesIcon className="h-4 w-4 mr-1" />
            {optimizing ? t("mc.running.optimize") : t("mc.btn.optimize.initial")}
          </Button>
          <Button
            onClick={() => handleOptimize("monthly")}
            color="blue"
            variant="secondary"
            size="sm"
            disabled={optimizing}
          >
            <SparklesIcon className="h-4 w-4 mr-1" />
            {optimizing ? t("mc.running.optimize") : t("mc.btn.optimize.monthly")}
          </Button>
          <Text className="text-xs text-slate-500 ml-auto max-w-md">{t("mc.hint.zoom")}</Text>
        </div>

        {/* Opt result banner */}
        {optMessage && (
          <div className="mt-3">
            {optMessage.kind === "ok" && (
              <Callout title={t("mc.optResult.hint")} color="emerald">
                <Text className="text-sm">
                  {optMessage.variable === "initial" ? t("mc.optResult.label.initial") : t("mc.optResult.label.monthly")}: {fmtEUR(optMessage.value || 0)}
                </Text>
              </Callout>
            )}
            {optMessage.kind === "needTarget" && (
              <Callout title={t("mc.optResult.needTarget")} color="amber" />
            )}
            {optMessage.kind === "tooHigh" && (
              <Callout title={t("mc.optResult.tooHigh")} color="rose" />
            )}
          </div>
        )}
      </Card>

      {/* Chart card */}
      <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
        <Title className="text-slate-100 mb-4">{t("mc.chart.title")}</Title>
        <div style={{ height: 420 }}>
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="year"
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(v) => `${v}`}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(v) => fmtCompact(v)}
                  width={70}
                />
                <Tooltip content={({ active, payload, label }) => tooltipContent(active || false, payload || [], label)} />
                <Area
                  type="monotone"
                  dataKey="bandMax"
                  stroke="none"
                  fill="#3b82f6"
                  fillOpacity={0.05}
                  name={t("mc.legend.bounds")}
                />
                <Area
                  type="monotone"
                  dataKey="bandMin"
                  stroke="none"
                  fill="#1e293b"
                  fillOpacity={0.4}
                  name={t("mc.legend.band")}
                />
                <Line
                  type="monotone"
                  dataKey="p10"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  name={t("mc.tooltip.pessimistic")}
                />
                <Line
                  type="monotone"
                  dataKey="p90"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  name={t("mc.tooltip.optimistic")}
                />
                <Line
                  type="monotone"
                  dataKey="p50"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={false}
                  name={t("mc.legend.median")}
                />
                <Line
                  type="monotone"
                  dataKey="invested"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  dot={false}
                  name={t("mc.legend.invested")}
                />
                {target > 0 && (
                  <Line
                    type="monotone"
                    dataKey="target"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    name={t("mc.legend.target")}
                  />
                )}
                {inflation > 0 && (
                  <>
                    <Line
                      type="monotone"
                      dataKey="p50r"
                      stroke="#0d9488"
                      strokeWidth={1.5}
                      strokeDasharray="1 3"
                      dot={false}
                      name={`${t("mc.legend.median")} (${t("mc.result.realSuffix")})`}
                    />
                    <Line
                      type="monotone"
                      dataKey="p10r"
                      stroke="#9f1239"
                      strokeWidth={1}
                      strokeDasharray="1 3"
                      dot={false}
                      name={`${t("mc.tooltip.pessimistic")} (${t("mc.result.realSuffix")})`}
                    />
                    <Line
                      type="monotone"
                      dataKey="p90r"
                      stroke="#1e40af"
                      strokeWidth={1}
                      strokeDasharray="1 3"
                      dot={false}
                      name={`${t("mc.tooltip.optimistic")} (${t("mc.result.realSuffix")})`}
                    />
                  </>
                )}
                <Brush
                  dataKey="year"
                  height={30}
                  stroke="#10b981"
                  fill="#1e293b"
                  travellerWidth={8}
                  tickFormatter={(v) => `${v}`}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#10b981" }}></i>
            {t("mc.legend.median")}
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#f43f5e" }}></i>
            {t("mc.legend.bounds")}
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#3b82f6" }}></i>
            {t("mc.legend.band")}
          </span>
          {target > 0 && (
            <span className="inline-flex items-center gap-2">
              <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#f59e0b" }}></i>
              {t("mc.legend.target")}
            </span>
          )}
          <span className="inline-flex items-center gap-2">
            <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#64748b" }}></i>
            {t("mc.legend.invested")}
          </span>
          {inflation > 0 && (
            <span className="inline-flex items-center gap-2">
              <i className="w-3.5 h-0.5 rounded-full" style={{ background: "#0d9488", borderTop: "2px dashed #0d9488" }}></i>
              {t("mc.legend.medianReal")}
            </span>
          )}
        </div>
      </Card>

      {/* Results grid */}
      {simResult && (
        <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
          <Title className="text-slate-100 mb-4">{t("mc.results.title")}</Title>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {/* Invested */}
            <ResultCard label={t("mc.result.invested")} value={fmtEUR(simResult.invested[simResult.invested.length - 1] || 0)} />
            {/* p10 */}
            <ResultCard label={t("mc.result.p10")} value={fmtCompact(simResult.series.p10[simResult.series.p10.length - 1] || 0)} />
            {/* p50 */}
            <ResultCard label={t("mc.result.p50")} value={fmtCompact(simResult.series.p50[simResult.series.p50.length - 1] || 0)} highlight />
            {/* p90 */}
            <ResultCard label={t("mc.result.p90")} value={fmtCompact(simResult.series.p90[simResult.series.p90.length - 1] || 0)} />
            {/* avgDd */}
            <ResultCard label={t("mc.result.avgDd")} value={fmtPct(simResult.avgMarketDrawdown * 100)} />
          </div>

          {/* Real (after inflation) variants */}
          {inflation > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <ResultCard
                label={`${t("mc.result.p10")} (${t("mc.result.realSuffix")})`}
                value={fmtCompact((simResult.series.p10[simResult.series.p10.length - 1] || 0) * inflationFactor)}
                dim
              />
              <ResultCard
                label={`${t("mc.result.p50")} (${t("mc.result.realSuffix")})`}
                value={fmtCompact((simResult.series.p50[simResult.series.p50.length - 1] || 0) * inflationFactor)}
                dim
              />
              <ResultCard
                label={`${t("mc.result.p90")} (${t("mc.result.realSuffix")})`}
                value={fmtCompact((simResult.series.p90[simResult.series.p90.length - 1] || 0) * inflationFactor)}
                dim
              />
            </div>
          )}

          {/* Note */}
          <Text className="mt-4 text-xs text-slate-500 leading-relaxed max-w-3xl block">
            {t("mc.note")}
          </Text>
        </Card>
      )}

      {/* Single trajectory section */}
      <Card className="bg-tremor-background dark:bg-slate-900/60 border-tremor-border border">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <Title className="text-slate-100">{t("mc.single.title")}</Title>
          <Button
            onClick={handleSingleRun}
            color="emerald"
            variant="secondary"
            size="sm"
          >
            <PlayIcon className="h-4 w-4 mr-1" />
            {t("mc.btn.singleRun")}
          </Button>
        </div>
        <Text className="text-sm text-slate-400 mb-4 block">{t("mc.single.intro")}</Text>

        {singleResult && (
          <>
            <div style={{ height: 320 }} className="mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={singleChartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => fmtCompact(v)} width={70} />
                  <Tooltip content={({ active, payload, label }) => tooltipContent(active || false, payload || [], label)} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="#10b981"
                    fillOpacity={0.08}
                    name={t("mc.tooltip.value")}
                  />
                  <Line
                    type="monotone"
                    dataKey="invested"
                    stroke="#64748b"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                    dot={false}
                    name={t("mc.tooltip.invested")}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ResultCard label={t("mc.single.final")} value={fmtCompact(singleResult.finalValue)} highlight />
              <ResultCard label={t("mc.single.peak")} value={fmtCompact(singleResult.peakValue)} />
              <ResultCard label={t("mc.single.ddMarket")} value={fmtPct(singleResult.marketMaxDrawdown * 100)} />
              <ResultCard label={t("mc.single.ddPortfolio")} value={fmtPct(singleResult.portfolioMaxDrawdown * 100)} />
            </div>

            {/* Real variants for single trajectory */}
            {inflation > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ResultCard
                  label={`${t("mc.single.final")} (${t("mc.result.realSuffix")})`}
                  value={fmtCompact(singleResult.finalValue * inflationFactor)}
                  dim
                />
                <ResultCard
                  label={`${t("mc.single.peak")} (${t("mc.result.realSuffix")})`}
                  value={fmtCompact(singleResult.peakValue * inflationFactor)}
                  dim
                />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function ResultCard({
  label,
  value,
  highlight,
  dim,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  dim?: boolean;
}): JSX.Element {
  return (
    <div
      className={`relative rounded-lg border p-4 transition-all hover:-translate-y-0.5 ${
        highlight
          ? "border-emerald-500/30 bg-emerald-500/5"
          : dim
          ? "border-slate-800 bg-slate-900/30"
          : "border-slate-800 bg-slate-900/50"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${
          highlight ? "text-emerald-300" : dim ? "text-slate-400" : "text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function MonteCarloSimulator(): JSX.Element {
  return (
    <I18nProvider>
      <MonteCarloSimulatorInner />
    </I18nProvider>
  );
}