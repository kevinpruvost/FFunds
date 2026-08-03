"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { I18nProvider } from "../i18n/I18nProvider";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PRESETS, type PresetKey } from "./MonteCarloSimulator";

/* ─────────────────────────── Types ─────────────────────────── */

type RiskLevel = "prudent" | "balanced" | "balanced-plus" | "aggressive" | "dangerous";

interface WizardState {
  currentAge: number;
  retirementAge: number;
  initial: number;
  monthly: number;
  inflation: number;
  risk: RiskLevel;
  desiredRevenue: number;
  desiredCapital: number;
}

interface SimResult {
  years: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  invested: number[];
  p10Real: number[];
  p50Real: number[];
  p90Real: number[];
  investedReal: number[];
  median: number;
  pessimistic: number;
  optimistic: number;
  medianReal: number;
  pessimisticReal: number;
  optimisticReal: number;
  totalInvested: number;
  totalInvestedReal: number;
  cagr: number;
  drawdown: number;
}

/* ─────────────────────────── Engine (local, lightweight) ─────────────────────────── */

const EPSILON = 1e-12;
const PROBE_PATHS = 10000;

const RISK_TO_PRESET: Record<RiskLevel, PresetKey> = {
  prudent: "all-weather",
  balanced: "golden",
  "balanced-plus": "golden-2x",
  aggressive: "golden-3x",
  dangerous: "nasdaq-2x",
};

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

function computeMonthlyVol(maxDrawdownFrac: number, years: number): number {
  const annualVol = maxDrawdownFrac / (Math.sqrt(Math.max(1, years)) * 0.6);
  return Math.max(0.005, annualVol / Math.sqrt(12));
}

function simulatePath(
  initial: number,
  monthly: number,
  monthlyReturn: number,
  monthlyVol: number,
  months: number,
): { yearly: number[]; final: number } {
  let value = initial;
  let totalInvested = initial;
  const yearly: number[] = [initial];

  for (let m = 1; m <= months; m++) {
    const r = monthlyReturn + normalRandom() * monthlyVol;
    value = Math.max(0, value * (1 + r) + monthly);
    totalInvested += monthly;
    if (m % 12 === 0) yearly.push(value);
  }
  return { yearly, final: value };
}

const WITHDRAWAL_RATE = 0.04;

// Goals are REAL (today's €). Compare against real projections; the solver
// grows the real target by inflation and works in nominal FV, using the
// Ito-corrected drift (mu - 0.5*sigma^2) which approximates the median path
// of a geometric growth process.
function computeGoalsAnalysis(s: WizardState, r: SimResult) {
  const requiredRevenuePortfolio = s.desiredRevenue * 12 / WITHDRAWAL_RATE;
  const requiredTotal = requiredRevenuePortfolio + s.desiredCapital;
  const years = Math.max(1, s.retirementAge - s.currentAge);
  const inflFrac = s.inflation / 100;
  const inflFactor = inflFrac > 0 ? Math.pow(1 + inflFrac, years) : 1;

  const shortfallMedian = requiredTotal - r.medianReal;
  const shortfallPessimistic = requiredTotal - r.pessimisticReal;
  const isAchievableMedian = shortfallMedian <= 0;
  const isAchievablePessimistic = shortfallPessimistic <= 0;

  const preset = PRESETS[RISK_TO_PRESET[s.risk]];
  const monthlyReturn = preset.cagr / 100 / 12;
  const monthlyVol = computeMonthlyVol(preset.drawdown / 100, years);
  const drift = monthlyReturn - 0.5 * monthlyVol * monthlyVol; // Ito median drift
  const months = years * 12;
  const targetNominal = requiredTotal * inflFactor;

  function fvNominal(initial: number, monthly: number, n: number): number {
    if (n <= 0) return initial;
    if (Math.abs(drift) < 1e-9) return initial + monthly * n;
    const g = Math.pow(1 + drift, n);
    return initial * g + (monthly * (g - 1)) / drift;
  }

  function solveMonthly(target: number, initial: number, n: number): number {
    if (n <= 0 || Math.abs(drift) < 1e-9) return Infinity;
    const g = Math.pow(1 + drift, n);
    const remaining = target - initial * g;
    if (remaining <= 0) return 0;
    return (remaining * drift) / (g - 1);
  }

  function solveInitial(target: number, monthly: number, n: number): number {
    if (n <= 0) return target;
    const g = Math.abs(drift) < 1e-9 ? 1 : Math.pow(1 + drift, n);
    const fvMonthly = monthly > 0 && Math.abs(drift) >= 1e-9 ? (monthly * (g - 1)) / drift : monthly * n;
    const remaining = target - fvMonthly;
    return Math.max(0, remaining / g);
  }

  function solveYears(target: number, initial: number, monthly: number): number {
    if (fvNominal(initial, monthly, 80 * 12) < target) return Infinity;
    let lo = 1, hi = 80;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (fvNominal(initial, monthly, mid * 12) >= target) hi = mid;
      else lo = mid;
    }
    return Math.ceil(hi);
  }

  const adjustments: { type: "monthly" | "initial" | "retirement" | "risk"; value: string }[] = [];

  if (!isAchievableMedian) {
    const needMonthly = solveMonthly(targetNominal, s.initial, months);
    if (Number.isFinite(needMonthly) && needMonthly > s.monthly) {
      adjustments.push({ type: "monthly", value: `${fmt(Math.round(needMonthly), "fr")} €/mois` });
    }
    const needInitial = solveInitial(targetNominal, s.monthly, months);
    if (Number.isFinite(needInitial) && needInitial > s.initial) {
      adjustments.push({ type: "initial", value: `${fmt(Math.round(needInitial), "fr")} €` });
    }
    const needYears = solveYears(targetNominal, s.initial, s.monthly);
    if (Number.isFinite(needYears) && needYears > years && s.currentAge + needYears <= 95) {
      adjustments.push({ type: "retirement", value: `${s.currentAge + needYears} ans` });
    }
  }

  if (!isAchievablePessimistic && s.risk !== "aggressive") {
    const order: RiskLevel[] = ["prudent", "balanced", "balanced-plus", "aggressive", "dangerous"];
    const next = order[order.indexOf(s.risk) + 1];
    if (next && next !== "dangerous") adjustments.push({ type: "risk", value: next });
  }

  return {
    requiredRevenuePortfolio,
    requiredTotal,
    shortfallMedian,
    shortfallPessimistic,
    isAchievableMedian,
    isAchievablePessimistic,
    adjustments,
    years,
  };
}

type GoalsAnalysis = ReturnType<typeof computeGoalsAnalysis>;

function runRetraiteSim(state: WizardState): SimResult {
  const preset = PRESETS[RISK_TO_PRESET[state.risk]];
  const years = Math.max(1, state.retirementAge - state.currentAge);
  const months = years * 12;
  const monthlyReturn = preset.cagr / 100 / 12;
  const monthlyVol = computeMonthlyVol(preset.drawdown / 100, years);
  const inflFrac = state.inflation / 100;

  const yearBuckets: number[][] = Array.from({ length: years + 1 }, () => []);
  const finals: number[] = [];

  for (let p = 0; p < PROBE_PATHS; p++) {
    const { yearly, final: finalVal } = simulatePath(
      state.initial,
      state.monthly,
      monthlyReturn,
      monthlyVol,
      months,
    );
    for (let y = 0; y <= years; y++) {
      if (y < yearly.length) yearBuckets[y].push(yearly[y]);
    }
    finals.push(finalVal);
  }

  const yearsArr: number[] = [];
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  const invested: number[] = [];
  const p10Real: number[] = [];
  const p50Real: number[] = [];
  const p90Real: number[] = [];
  const investedReal: number[] = [];

  for (let y = 0; y <= years; y++) {
    const sorted = yearBuckets[y].slice().sort((a, b) => a - b);
    const realFactor = inflFrac > 0 ? 1 / Math.pow(1 + inflFrac, y) : 1;
    yearsArr.push(state.currentAge + y);
    p10.push(percentile(sorted, 10));
    p50.push(percentile(sorted, 50));
    p90.push(percentile(sorted, 90));
    p10Real.push(p10[p10.length - 1] * realFactor);
    p50Real.push(p50[p50.length - 1] * realFactor);
    p90Real.push(p90[p90.length - 1] * realFactor);
    const inv = state.initial + state.monthly * Math.min(y * 12, months);
    invested.push(inv);
    investedReal.push(inv * realFactor);
  }

  const sortedFinals = finals.slice().sort((a, b) => a - b);
  const medianNominal = percentile(sortedFinals, 50);
  const pessimisticNominal = percentile(sortedFinals, 10);
  const optimisticNominal = percentile(sortedFinals, 90);
  const finalRealFactor = inflFrac > 0 ? 1 / Math.pow(1 + inflFrac, years) : 1;
  const totalInvestedNominal = state.initial + state.monthly * months;

  return {
    years: yearsArr,
    p10,
    p50,
    p90,
    invested,
    p10Real,
    p50Real,
    p90Real,
    investedReal,
    median: medianNominal,
    pessimistic: pessimisticNominal,
    optimistic: optimisticNominal,
    medianReal: medianNominal * finalRealFactor,
    pessimisticReal: pessimisticNominal * finalRealFactor,
    optimisticReal: optimisticNominal * finalRealFactor,
    totalInvested: totalInvestedNominal,
    totalInvestedReal: totalInvestedNominal * finalRealFactor,
    cagr: preset.cagr,
    drawdown: preset.drawdown,
  };
}

/* ─────────────────────────── Cookie ─────────────────────────── */

const COOKIE_NAME = "ffunds_retraite_params";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface CookieData {
  step: number;
  state: WizardState;
  completed: boolean;
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

/* ─────────────────────────── Helpers ─────────────────────────── */

function fmt(n: number, lang: "fr" | "en"): string {
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtCompact(n: number, lang: "fr" | "en"): string {
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/* ─────────────────────────── Cross-page transfer ─────────────────────────── */

const GOLDEN_TICKERS: Record<string, number> = {
  "MSCI-WORLD-MOMENTUM": 20,
  "MSCI-WORLD-SMALL": 9,
  "MSCI-WORLD-QUALITY": 10,
  XLU: 10,
  TLT: 14,
  SHY: 6,
  KMLM: 15,
  GLD: 16,
};

const ALL_WEATHER_TICKERS: Record<string, number> = {
  SPY: 15,
  EFA: 15,
  TLT: 30,
  IEF: 10,
  GLD: 7.5,
  DBC: 7.5,
  KMLM: 15,
};

const PA_PRESETS: Record<RiskLevel, Record<string, number>> = {
  prudent: ALL_WEATHER_TICKERS,
  balanced: GOLDEN_TICKERS,
  "balanced-plus": GOLDEN_TICKERS,
  aggressive: GOLDEN_TICKERS,
  dangerous: { QLD: 100 },
};

const PA_COOKIE_NAME = "ffunds_pa_params";
const PA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const MC_COOKIE_NAME = "ffunds_mc_params";
const MC_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeRawCookie(name: string, value: string, maxAge: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

function transferToAllocator(s: WizardState): void {
  const weights = PA_PRESETS[s.risk];
  const selectedTickers = Object.keys(weights);
  const leveraged = s.risk === "balanced-plus" || s.risk === "aggressive";
  const marginLeverage =
    s.risk === "balanced-plus" ? 2 :
    s.risk === "aggressive" ? 3 : 1;
  const marginLoanRatePct =
    s.risk === "balanced-plus" || s.risk === "aggressive" ? 4 : 5;
  const data = {
    selectedTickers,
    weights,
    initialInvestment: s.initial,
    monthlyContribution: s.monthly,
    rebalance: "annual",
    marginEnabled: leveraged,
    marginLeverage,
    marginLoanRatePct,
    marginInterestFreq: "monthly",
    marginRebalance: leveraged,
    marginRebalanceMode: leveraged ? "bidirectional" : "gains-only",
    inflationPct: s.inflation,
  };
  writeRawCookie(PA_COOKIE_NAME, JSON.stringify(data), PA_COOKIE_MAX_AGE);
}

function transferToSimulator(s: WizardState): void {
  const preset = RISK_TO_PRESET[s.risk];
  const p = PRESETS[preset];
  const data = {
    preset,
    currentAge: s.currentAge,
    retirementAge: s.retirementAge,
    stopAge: s.retirementAge,
    initial: s.initial,
    monthly: s.monthly,
    cagr: p.cagr,
    inflation: s.inflation,
    drawdown: p.drawdown,
    target: 0,
    paths: 1000,
    forceDrawdown: true,
  };
  writeRawCookie(MC_COOKIE_NAME, JSON.stringify(data), MC_COOKIE_MAX_AGE);
}

/* ─────────────────────────── Component ─────────────────────────── */

const TOTAL_STEPS = 7;

function DebouncedInput(props: {
  value: number;
  min: number;
  max: number;
  isCurrency?: boolean;
  onCommit: (v: number) => void;
}): JSX.Element {
  const { value, min, max, isCurrency, onCommit } = props;
  const [text, setText] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = (): void => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) {
      const clamped = Math.max(min, Math.min(max, v));
      onCommit(clamped);
      setText(String(clamped));
    } else {
      setText(String(value));
    }
  };

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 tabular-nums outline-none focus:border-teal-500/50";

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={inputCls}
      />
      {isCurrency && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">€</span>
      )}
    </div>
  );
}

function RetraiteSimplifieeInner(): JSX.Element {
  const { lang, t } = useI18n();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [state, setState] = useState<WizardState>({
    currentAge: 35,
    retirementAge: 65,
    initial: 10000,
    monthly: 300,
    inflation: 2.5,
    risk: "prudent",
    desiredRevenue: 2000,
    desiredCapital: 50000,
  });
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const simVersionRef = useRef(0);

  // Load from cookie on mount
  useEffect(() => {
    const raw = readCookie(COOKIE_NAME);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<CookieData>;
      if (data.state) {
        setState({
          currentAge: typeof data.state.currentAge === "number" ? data.state.currentAge : 35,
          retirementAge: typeof data.state.retirementAge === "number" ? data.state.retirementAge : 65,
          initial: typeof data.state.initial === "number" ? data.state.initial : 10000,
          monthly: typeof data.state.monthly === "number" ? data.state.monthly : 300,
          inflation: typeof data.state.inflation === "number" ? data.state.inflation : 2.5,
          risk: data.state.risk ?? "prudent",
          desiredRevenue: typeof data.state.desiredRevenue === "number" ? data.state.desiredRevenue : 2000,
          desiredCapital: typeof data.state.desiredCapital === "number" ? data.state.desiredCapital : 50000,
        });
      }
      if (typeof data.step === "number" && data.step >= 0 && data.step <= TOTAL_STEPS) {
        setStep(data.step);
      }
      if (typeof data.completed === "boolean") {
        setCompleted(data.completed);
      }
    } catch {
      /* ignore malformed cookie */
    }
  }, []);

  // Persist on change
  useEffect(() => {
    const data: CookieData = { step, state, completed };
    writeCookie(COOKIE_NAME, JSON.stringify(data), COOKIE_MAX_AGE);
  }, [step, state, completed]);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return state.currentAge >= 18 && state.currentAge <= 80;
      case 1: return state.retirementAge > state.currentAge && state.retirementAge <= 95;
      case 2: return state.desiredRevenue >= 0 && state.desiredCapital >= 0;
      case 3: return state.initial >= 0;
      case 4: return state.monthly >= 0;
      case 5: return state.inflation >= 0 && state.inflation <= 20;
      case 6: return true;
      default: return false;
    }
  }, [step, state]);

  function next(): void {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    } else {
      setCompleted(true);
      runSim();
    }
  }

  function prev(): void {
    if (step > 0) setStep(step - 1);
  }

  function restart(): void {
    setStep(0);
    setCompleted(false);
    setResult(null);
  }

  function runSim(override?: WizardState): void {
    setRunning(true);
    const version = ++simVersionRef.current;
    const simState = override ?? state;
    setTimeout(() => {
      if (version !== simVersionRef.current) return;
      const r = runRetraiteSim(simState);
      if (version !== simVersionRef.current) return;
      setResult(r);
      setRunning(false);
    }, 50);
  }

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.years.map((y, i) => ({
      year: y,
      p10: Math.round(result.p10[i]),
      p50: Math.round(result.p50[i]),
      p90: Math.round(result.p90[i]),
      invested: Math.round(result.invested[i]),
      p10r: Math.round(result.p10Real[i]),
      p50r: Math.round(result.p50Real[i]),
      p90r: Math.round(result.p90Real[i]),
      investedr: Math.round(result.investedReal[i]),
    }));
  }, [result]);

  /* ────────────────── Render: Results ────────────────── */

  if (completed && result) {
    const growth = result.median - result.totalInvested;
    const growthReal = result.medianReal - result.totalInvestedReal;
    const presetKey = RISK_TO_PRESET[state.risk];
    const showReal = state.inflation > 0;
    const goals = computeGoalsAnalysis(state, result);
    return (
      <div className="retraite-result grid gap-6 lg:grid-cols-[1fr_1.4fr] fade-slide-in">
        {/* Left column: tips + actions + go further */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-xs text-amber-300/80 leading-relaxed">{t("ret.res.note")}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => { setCompleted(false); setStep(0); setResult(null); }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
            >
              {t("ret.btn.restart")}
            </button>
            <button
              onClick={() => runSim()}
              disabled={running}
              className="rounded-lg border border-teal-500/40 bg-teal-500/20 px-4 py-2 text-sm font-medium text-teal-200 transition hover:bg-teal-500/30 disabled:opacity-50"
            >
              {t("ret.btn.resimulate")}
            </button>
          </div>

          <div className="rounded-2xl border border-teal-500/20 bg-slate-900/40 p-5">
            <h3 className="text-sm font-semibold text-slate-100">{t("ret.cta.title")}</h3>
            <p className="mt-1 text-xs text-slate-400">{t("ret.cta.desc")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => { transferToAllocator(state); window.location.href = "/FFunds/allocator"; }}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25"
              >
                {t("ret.cta.toAllocator")}
              </button>
              <button
                onClick={() => { transferToSimulator(state); window.location.href = "/FFunds/simulations"; }}
                className="rounded-lg border border-blue-500/40 bg-blue-500/15 px-4 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/25"
              >
                {t("ret.cta.toSimulator")}
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-600">{t("ret.res.cookie.saved")}</p>

          {/* Goals analysis */}
          <div className={`rounded-2xl border p-5 ${goals.isAchievableMedian ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <h3 className="text-sm font-semibold text-slate-100">
              {goals.isAchievableMedian ? t("ret.goals.res.achievable") : t("ret.goals.res.shortfall")}
            </h3>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">{t("ret.goals.res.required")}</span>
                <span className="tabular-nums text-slate-200">{fmt(goals.requiredTotal, lang)} €</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t("ret.goals.res.revenuePortfolio")}</span>
                <span className="tabular-nums text-slate-200">{fmt(goals.requiredRevenuePortfolio, lang)} €</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t("ret.goals.res.consumableCapital")}</span>
                <span className="tabular-nums text-slate-200">{fmt(state.desiredCapital, lang)} €</span>
              </div>
              <div className="my-2 h-px bg-slate-800" />
              <div className="flex justify-between">
                <span className="text-slate-400">{t("ret.goals.res.medianProjection")}</span>
                <span className="tabular-nums text-teal-300">{fmt(result.medianReal, lang)} €</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t("ret.goals.res.pessimisticProjection")}</span>
                <span className="tabular-nums text-rose-400">{fmt(result.pessimisticReal, lang)} €</span>
              </div>
              {!goals.isAchievableMedian && (
                <>
                  <div className="my-2 h-px bg-slate-800" />
                  <div className="flex justify-between">
                    <span className="text-amber-300">{t("ret.goals.res.shortfallMedian")}</span>
                    <span className="tabular-nums text-amber-300">{fmt(goals.shortfallMedian, lang)} €</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rose-400">{t("ret.goals.res.shortfallPessimistic")}</span>
                    <span className="tabular-nums text-rose-400">{fmt(goals.shortfallPessimistic, lang)} €</span>
                  </div>
                </>
              )}
            </div>

            {goals.adjustments.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-300">{t("ret.goals.res.adjustments.title")}</p>
                <ul className="mt-2 space-y-1.5">
                  {goals.adjustments.map((a, i) => {
                    const label = a.type === "risk"
                      ? t(`ret.s5.opt.${a.value}.title`)
                      : a.value;
                    return (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                        <span className="mt-0.5 text-teal-400">•</span>
                        <span>
                          <span className="font-medium text-slate-200">{t(`ret.goals.res.adjustments.${a.type}`)}</span>
                          {" : "}
                          <span className="tabular-nums text-teal-300">{label}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {goals.isAchievableMedian && (
              <p className="mt-3 text-xs text-emerald-300/80 leading-relaxed">
                {goals.isAchievablePessimistic
                  ? t("ret.goals.res.achievablePessimistic")
                  : t("ret.goals.res.achievableMedianOnly")}
              </p>
            )}
          </div>
        </div>

        {/* Right column: compact sim results */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-teal-500/20 bg-slate-900/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-50">{t("ret.res.title")}</h2>
                <p className="mt-0.5 text-xs text-slate-400">{t("ret.res.subtitle", { paths: PROBE_PATHS, preset: presetKey })}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.inflation")} (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={String(state.inflation)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 20) setState({ ...state, inflation: v });
                  }}
                  onBlur={() => {
                    if (!Number.isFinite(state.inflation) || state.inflation < 0) setState({ ...state, inflation: 0 });
                    if (state.inflation > 20) setState({ ...state, inflation: 20 });
                    runSim();
                  }}
                  className="w-16 bg-transparent text-right text-sm font-semibold tabular-nums text-teal-300 outline-none"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.pessimistic")}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-rose-400">{fmt(result.pessimistic, lang)} €</p>
                {showReal && (
                  <p className="mt-0.5 text-xs tabular-nums text-rose-400/60">{fmt(result.pessimisticReal, lang)} € ({t("ret.res.realSuffix")})</p>
                )}
              </div>
              <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-teal-400">{t("ret.res.median")}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-teal-300">{fmt(result.median, lang)} €</p>
                {showReal && (
                  <p className="mt-0.5 text-xs tabular-nums text-teal-300/60">{fmt(result.medianReal, lang)} € ({t("ret.res.realSuffix")})</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.optimistic")}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">{fmt(result.optimistic, lang)} €</p>
                {showReal && (
                  <p className="mt-0.5 text-xs tabular-nums text-emerald-400/60">{fmt(result.optimisticReal, lang)} € ({t("ret.res.realSuffix")})</p>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.invested")}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-100">{fmt(result.totalInvested, lang)} €</p>
                {showReal && (
                  <p className="mt-0.5 text-xs tabular-nums text-slate-400">{fmt(result.totalInvestedReal, lang)} € ({t("ret.res.realSuffix")})</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.growth")}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-emerald-400">
                  {growth >= 0 ? "+" : ""}{fmt(growth, lang)} €
                </p>
                {showReal && (
                  <p className="mt-0.5 text-xs tabular-nums text-emerald-400/70">
                    {growthReal >= 0 ? "+" : ""}{fmt(growthReal, lang)} € ({t("ret.res.realSuffix")})
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>{t("ret.res.years")}: <span className="text-slate-300">{result.years.length - 1}</span></span>
              <span>{t("ret.res.preset")}: <span className="text-slate-300">{presetKey}</span></span>
              <span>{t("ret.res.cagr")}: <span className="text-slate-300">{result.cagr}%</span></span>
              <span>{t("ret.res.drawdown")}: <span className="text-slate-300">{result.drawdown}%</span></span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <defs>
                    <linearGradient id="retP90Fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} tickFormatter={(v: number) => fmtCompact(v, lang)} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#94a3b8" }}
                    formatter={(value, name) => [`${fmt(Number(value), lang)} €`, String(name)]}
                  />
                  <Area type="monotone" dataKey="p90" stroke="#14b8a6" strokeWidth={1} fill="url(#retP90Fill)" name={t("ret.res.optimistic")} />
                  <Area type="monotone" dataKey="p10" stroke="#f43f5e" strokeWidth={1} fillOpacity={0} name={t("ret.res.pessimistic")} />
                  <Line type="monotone" dataKey="p50" stroke="#14b8a6" strokeWidth={2.5} dot={false} name={t("ret.res.median")} />
                  <Line type="monotone" dataKey="invested" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name={t("ret.res.invested")} />
                  {showReal && (
                    <>
                      <Line type="monotone" dataKey="p90r" stroke="#1e40af" strokeWidth={1} strokeDasharray="1 3" dot={false} name={t("ret.res.optimisticReal")} />
                      <Line type="monotone" dataKey="p50r" stroke="#0d9488" strokeWidth={1.5} strokeDasharray="1 3" dot={false} name={t("ret.res.medianReal")} />
                      <Line type="monotone" dataKey="p10r" stroke="#9f1239" strokeWidth={1} strokeDasharray="1 3" dot={false} name={t("ret.res.pessimisticReal")} />
                      <Line type="monotone" dataKey="investedr" stroke="#64748b" strokeWidth={1} strokeDasharray="1 3" dot={false} name={t("ret.res.investedReal")} />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-sm font-semibold text-slate-100">{t("ret.res.adjust.title")}</h3>
            <p className="mt-1 text-xs text-slate-400">{t("ret.res.adjust.desc")}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.adjust.strategy")}</label>
                <select
                  value={state.risk}
                  onChange={(e) => { const ns = { ...state, risk: e.target.value as RiskLevel }; setState(ns); runSim(ns); }}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500/50"
                >
                  {RISK_OPTIONS.map(({ key }) => (
                    <option key={key} value={key}>{t(`ret.s5.opt.${key}.title`)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.adjust.retirementAge")}</label>
                <div className="mt-1">
                  <DebouncedInput
                    value={state.retirementAge}
                    min={state.currentAge + 1}
                    max={95}
                    onCommit={(v) => { const ns = { ...state, retirementAge: v }; setState(ns); runSim(ns); }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.adjust.initial")}</label>
                <div className="mt-1">
                  <DebouncedInput
                    value={state.initial}
                    min={0}
                    max={100000000}
                    isCurrency
                    onCommit={(v) => { const ns = { ...state, initial: v }; setState(ns); runSim(ns); }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.res.adjust.monthly")}</label>
                <div className="mt-1">
                  <DebouncedInput
                    value={state.monthly}
                    min={0}
                    max={10000000}
                    isCurrency
                    onCommit={(v) => { const ns = { ...state, monthly: v }; setState(ns); runSim(ns); }}
                  />
                </div>
              </div>
            </div>

            {state.risk === "dangerous" && (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
                <p className="text-xs font-medium text-rose-300">{t("ret.res.adjust.dangerous.title")}</p>
                <p className="mt-1 text-xs text-rose-200/80 leading-relaxed">{t("ret.res.adjust.dangerous.desc")}</p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-teal-500/20 bg-slate-900/60 p-5">
            <h3 className="text-sm font-semibold text-slate-100">{t("ret.goals.res.adjustments.title")}</h3>
            <p className="mt-1 text-xs text-slate-400">{t("ret.goals.desc")}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.goals.revenue.label")}</label>
                <div className="mt-1">
                  <DebouncedInput
                    value={state.desiredRevenue}
                    min={0}
                    max={10000}
                    isCurrency
                    onCommit={(v) => { const ns = { ...state, desiredRevenue: v }; setState(ns); runSim(ns); }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{t("ret.goals.revenue.hint")}</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">{t("ret.goals.capital.label")}</label>
                <div className="mt-1">
                  <DebouncedInput
                    value={state.desiredCapital}
                    min={0}
                    max={500000}
                    isCurrency
                    onCommit={(v) => { const ns = { ...state, desiredCapital: v }; setState(ns); runSim(ns); }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{t("ret.goals.capital.hint")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────── Render: Running spinner ────────────────── */

  if (completed && running) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-teal-500/30 border-t-teal-400" />
          <p className="mt-4 text-sm text-slate-400">{t("ret.res.title")}</p>
        </div>
      </div>
    );
  }

  /* ────────────────── Render: Wizard ────────────────── */

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{t("ret.step")} {step + 1} {t("ret.step.of")} {TOTAL_STEPS}</span>
          <span>{Math.round(((step + 1) / TOTAL_STEPS) * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-300 transition-all duration-500 ease-out"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content with animation key */}
      <div key={step} className="fade-slide-in">
        {step === 0 && (
          <StepCard
            title={t("ret.s1.title")}
            desc={t("ret.s1.desc")}
            placeholder={t("ret.s1.placeholder")}
            value={state.currentAge}
            min={18}
            max={80}
            onChange={(v) => setState({ ...state, currentAge: v })}
          />
        )}

        {step === 1 && (
          <StepCard
            title={t("ret.s2.title")}
            desc={t("ret.s2.desc")}
            placeholder={t("ret.s2.placeholder")}
            value={state.retirementAge}
            min={state.currentAge + 1}
            max={95}
            onChange={(v) => setState({ ...state, retirementAge: v })}
          />
        )}

        {step === 2 && (
          <GoalsStep
            desiredRevenue={state.desiredRevenue}
            desiredCapital={state.desiredCapital}
            onChangeRevenue={(v) => setState({ ...state, desiredRevenue: v })}
            onChangeCapital={(v) => setState({ ...state, desiredCapital: v })}
          />
        )}

        {step === 3 && (
          <StepCard
            title={t("ret.s3.title")}
            desc={t("ret.s3.desc")}
            placeholder={t("ret.s3.placeholder")}
            value={state.initial}
            min={0}
            max={1_000_000}
            step={500}
            isCurrency
            onChange={(v) => setState({ ...state, initial: v })}
          />
        )}

        {step === 4 && (
          <StepCard
            title={t("ret.s4.title")}
            desc={t("ret.s4.desc")}
            placeholder={t("ret.s4.placeholder")}
            value={state.monthly}
            min={0}
            max={10_000}
            step={50}
            isCurrency
            onChange={(v) => setState({ ...state, monthly: v })}
          />
        )}

        {step === 5 && (
          <StepCard
            title={t("ret.s5.inflation.title")}
            desc={t("ret.s5.inflation.desc")}
            placeholder={t("ret.s5.inflation.placeholder")}
            value={state.inflation}
            min={0}
            max={20}
            step={0.1}
            isDecimal
            onChange={(v) => setState({ ...state, inflation: v })}
          />
        )}

        {step === 6 && (
          <RiskStep
            value={state.risk}
            onChange={(r) => setState({ ...state, risk: r })}
          />
        )}
      </div>

      {/* Nav buttons */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={prev}
          disabled={step === 0}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {t("ret.btn.prev")}
        </button>
        <button
          onClick={next}
          disabled={!canAdvance}
          className="rounded-lg border border-teal-500/40 bg-teal-500/20 px-6 py-2 text-sm font-semibold text-teal-100 transition hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {step === TOTAL_STEPS - 1 ? t("ret.btn.adjust") : t("ret.btn.next")}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Step components ─────────────────────────── */

function StepCard(props: {
  title: string;
  desc: string;
  placeholder: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isCurrency?: boolean;
  isDecimal?: boolean;
  onChange: (v: number) => void;
}): JSX.Element {
  const { lang } = useI18n();
  const { title, desc, placeholder, value, min, max, step = 1, isCurrency, isDecimal, onChange } = props;

  const [text, setText] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const parseVal = (s: string): number => {
    if (isCurrency || isDecimal) {
      const v = parseFloat(s);
      return Number.isFinite(v) ? v : NaN;
    }
    const v = parseInt(s, 10);
    return Number.isFinite(v) ? v : NaN;
  };

  const commit = (): void => {
    const v = parseVal(text);
    if (Number.isFinite(v)) {
      const clamped = Math.max(min, Math.min(max, v));
      onChange(clamped);
      setText(String(clamped));
    } else {
      setText(String(value));
    }
  };

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-50 outline-none transition focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
      <h2 className="text-xl font-bold text-slate-50">{title}</h2>
      <p className="mt-2 text-sm text-slate-400 leading-relaxed">{desc}</p>

      <div className="mt-6">
        {isCurrency ? (
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={text}
              placeholder={placeholder}
              onFocus={() => setFocused(true)}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { setFocused(false); commit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`${inputCls} text-2xl font-semibold tabular-nums`}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-600">€</span>
          </div>
        ) : isDecimal ? (
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={text}
              placeholder={placeholder}
              onFocus={() => setFocused(true)}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { setFocused(false); commit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`${inputCls} text-center text-4xl font-bold tabular-nums`}
            />
            <div className="mt-1 text-center text-xs text-slate-500">%</div>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={text}
              placeholder={placeholder}
              onFocus={() => setFocused(true)}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { setFocused(false); commit(); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className={`${inputCls} text-center text-4xl font-bold tabular-nums`}
            />
            <div className="mt-1 text-center text-xs text-slate-500">{lang === "fr" ? "ans" : "yrs"}</div>
          </div>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="mt-4 w-full accent-teal-500"
        />
      </div>
    </div>
  );
}

const RISK_OPTIONS: { key: RiskLevel; selectedClass: string; selectedText: string }[] = [
  { key: "prudent", selectedClass: "border-emerald-500/60 bg-emerald-500/10", selectedText: "text-emerald-300" },
  { key: "balanced", selectedClass: "border-sky-500/60 bg-sky-500/10", selectedText: "text-sky-300" },
  { key: "balanced-plus", selectedClass: "border-violet-500/60 bg-violet-500/10", selectedText: "text-violet-300" },
  { key: "aggressive", selectedClass: "border-amber-500/60 bg-amber-500/10", selectedText: "text-amber-300" },
  { key: "dangerous", selectedClass: "border-rose-500/60 bg-rose-500/10", selectedText: "text-rose-300" },
];

function GoalsStep(props: {
  desiredRevenue: number;
  desiredCapital: number;
  onChangeRevenue: (v: number) => void;
  onChangeCapital: (v: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  const { desiredRevenue, desiredCapital, onChangeRevenue, onChangeCapital } = props;
  const requiredPortfolio = desiredRevenue * 12 / WITHDRAWAL_RATE;
  const requiredTotal = requiredPortfolio + desiredCapital;

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-50 outline-none transition focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
      <h2 className="text-xl font-bold text-slate-50">{t("ret.goals.title")}</h2>
      <p className="mt-2 text-sm text-slate-400 leading-relaxed">{t("ret.goals.desc")}</p>

      <div className="mt-4 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
        <p className="text-xs font-medium text-teal-300">{t("ret.goals.rule.title")}</p>
        <p className="mt-1 text-xs text-slate-300 leading-relaxed">{t("ret.goals.rule.body1")}</p>
        <p className="mt-1 text-xs text-slate-400 leading-relaxed">{t("ret.goals.rule.body2")}</p>
      </div>

      <div className="mt-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300">{t("ret.goals.revenue.label")}</label>
          <p className="mt-1 text-xs text-slate-500">{t("ret.goals.revenue.hint")}</p>
          <div className="relative mt-3">
            <input
              type="text"
              inputMode="numeric"
              value={String(desiredRevenue)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) onChangeRevenue(v);
              }}
              className={`${inputCls} text-2xl font-semibold tabular-nums`}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">€/mois</span>
          </div>
          <input
            type="range"
            min={0}
            max={10000}
            step={100}
            value={desiredRevenue}
            onChange={(e) => onChangeRevenue(parseFloat(e.target.value))}
            className="mt-3 w-full accent-teal-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300">{t("ret.goals.capital.label")}</label>
          <p className="mt-1 text-xs text-slate-500">{t("ret.goals.capital.hint")}</p>
          <div className="relative mt-3">
            <input
              type="text"
              inputMode="numeric"
              value={String(desiredCapital)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) onChangeCapital(v);
              }}
              className={`${inputCls} text-2xl font-semibold tabular-nums`}
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-slate-600">€</span>
          </div>
          <input
            type="range"
            min={0}
            max={500000}
            step={5000}
            value={desiredCapital}
            onChange={(e) => onChangeCapital(parseFloat(e.target.value))}
            className="mt-3 w-full accent-teal-500"
          />
        </div>

        <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-4 space-y-2">
          <p className="text-xs font-medium text-teal-200">{t("ret.goals.calc.title")}</p>
          <div className="text-xs text-slate-400 leading-relaxed">
            <div>{t("ret.goals.calc.revenueAnnual", { monthly: desiredRevenue, annual: fmt(desiredRevenue * 12, "fr") })}</div>
            <div className="mt-1">{t("ret.goals.calc.portfolio", { annual: fmt(desiredRevenue * 12, "fr"), portfolio: fmt(requiredPortfolio, "fr") })}</div>
            <div className="mt-1">{t("ret.goals.calc.total", { portfolio: fmt(requiredPortfolio, "fr"), capital: fmt(desiredCapital, "fr"), total: fmt(requiredTotal, "fr") })}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskStep(props: { value: RiskLevel; onChange: (r: RiskLevel) => void }): JSX.Element {
  const { t } = useI18n();
  const { value, onChange } = props;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
        <h2 className="text-xl font-bold text-slate-50">{t("ret.s5.title")}</h2>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">{t("ret.s5.desc")}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {RISK_OPTIONS.map(({ key, selectedClass, selectedText }) => {
            const selected = value === key;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={`rounded-xl border p-4 text-left transition-all duration-200 ${
                  selected
                    ? selectedClass
                    : "border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900"
                }`}
              >
                <p className={`text-sm font-semibold ${selected ? selectedText : "text-slate-200"}`}>
                  {t(`ret.s5.opt.${key}.title`)}
                </p>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                  {t(`ret.s5.opt.${key}.desc`)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm font-medium text-amber-300">{t("ret.s5.volatility.explain")}</p>
        <p className="mt-1 text-xs text-amber-200/70 leading-relaxed">{t("ret.s5.volatility.body")}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Default export ─────────────────────────── */

export default function RetraiteSimplifiee(): JSX.Element {
  return (
    <I18nProvider>
      <RetraiteSimplifieeInner />
    </I18nProvider>
  );
}