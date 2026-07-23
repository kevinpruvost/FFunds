#!/usr/bin/env node
/**
 * Fetch historical monthly adjusted-close prices from Yahoo Finance
 * and bake them into src/data/prices.json for the static Astro build.
 *
 * Usage: node scripts/fetch-prices.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, "..");
const CONFIG_PATH = join(ROOT, "src", "data", "tickers.config.json");
const OUTPUT_PATH = join(ROOT, "src", "data", "prices.json");

// 1999-01-01 — covers QQQ inception (1999-03-10) and most other US ETFs.
// Yahoo returns data from each ticker's actual listing date onward.
const PERIOD1 = 915148800; // 1999-01-01 00:00:00 UTC
const PERIOD2 = Math.floor(Date.now() / 1000);

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};

const SLEEP_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(unixSec) {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function fetchTicker(ticker, attempt = 1) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${PERIOD1}&period2=${PERIOD2}&interval=1mo&events=div,splits`;
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
    });
    if (!res.ok) {
      if (res.status === 429 && attempt < 3) {
        const backoff = 1000 * Math.pow(2, attempt - 1);
        console.warn(`  [${ticker}] 429 — retrying in ${backoff}ms (attempt ${attempt + 1}/3)`);
        await sleep(backoff);
        return fetchTicker(ticker, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json.chart?.error) {
      throw new Error(json.chart.error.description || JSON.stringify(json.chart.error));
    }
    const result = json.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0]?.close || [];
    const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];

    const monthlyByKey = {};
    for (let i = 0; i < timestamps.length; i++) {
      const close = adjclose[i] ?? quote[i];
      if (close == null || Number.isNaN(close)) continue;
      const date = formatDate(timestamps[i]);
      // Keep last entry per month (Yahoo returns in chronological order,
      // so later entries overwrite earlier for the same month key).
      monthlyByKey[date] = Number(close);
    }
    const monthly = Object.entries(monthlyByKey)
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    if (monthly.length === 0) throw new Error("No valid price points");

    return {
      ticker,
      startDate: monthly[0].date,
      endDate: monthly[monthly.length - 1].date,
      monthly,
    };
  } catch (err) {
    if (attempt < 3) {
      const backoff = 1000 * Math.pow(2, attempt - 1);
      console.warn(`  [${ticker}] ${err.message} — retrying in ${backoff}ms (attempt ${attempt + 1}/3)`);
      await sleep(backoff);
      return fetchTicker(ticker, attempt + 1);
    }
    throw err;
  }
}

function monthKeyFromIso(isoDate) {
  // ISO "YYYY-MM-DD" → "YYYY-MM"
  return isoDate.slice(0, 7);
}

// Parse MSCI CSV format: 4 header lines (Index Level/Currency/blank/Date column),
// then monthly rows `YYYY-MM-DD,<value>,,...`. Columns 2..end are noise
// (MSCI legal disclaimer text merged with the data column).
function parseMsciCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  const monthly = [];
  for (let i = 4; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(",");
    const date = cols[0];
    const value = Number(cols[1]);
    if (!date || !Number.isFinite(value)) continue;
    monthly.push({ date: monthKeyFromIso(date), close: value });
  }
  if (monthly.length === 0) throw new Error("MSCI CSV yielded no rows");
  return monthly;
}

// Parse KMLM daily CSV: 1 header line, then `YYYY-MM-DD,Return(%),Balance`.
// Daily data — resample to monthly by taking the last available close of each
// calendar month (last trading day = month-end convention).
function parseKmlmCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  const byMonth = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(",");
    const date = cols[0];
    const balance = Number(cols[2]);
    if (!date || !Number.isFinite(balance)) continue;
    const monthKey = monthKeyFromIso(date);
    byMonth.set(monthKey, balance);
  }
  const monthly = [];
  for (const [date, close] of byMonth) monthly.push({ date, close });
  monthly.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (monthly.length === 0) throw new Error("KMLM CSV yielded no rows");
  return monthly;
}

function readCsvOverride(csvFileName, tickerName) {
  const csvPath = join(ROOT, "src", "data", csvFileName);
  const text = readFileSync(csvPath, "utf-8");
  if (csvFileName === "kmlm.csv") return parseKmlmCsv(text);
  return parseMsciCsv(text);
}

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const total = config.length;
  const prices = {};

  for (let i = 0; i < total; i++) {
    const entry = config[i];
    const ticker = entry.ticker;

    // CSV overrides skip Yahoo entirely — they are longer-historical index
    // series committed to the repo and need no network access.
    if (entry.csv) {
      try {
        const monthly = readCsvOverride(entry.csv, ticker);
        prices[ticker] = {
          startDate: monthly[0].date,
          endDate: monthly[monthly.length - 1].date,
          monthly,
        };
        console.log(`[${String(i + 1).padStart(2, "0")}/${total}] ${ticker}: ${monthly.length} months from CSV ${entry.csv} (${monthly[0].date} → ${monthly[monthly.length - 1].date})`);
      } catch (err) {
        console.error(`[${String(i + 1).padStart(2, "0")}/${total}] ${ticker}: CSV FAILED — ${err.message}`);
      }
      continue;
    }

    try {
      const data = await fetchTicker(ticker);
      prices[ticker] = {
        startDate: data.startDate,
        endDate: data.endDate,
        monthly: data.monthly,
      };
      console.log(`[${String(i + 1).padStart(2, "0")}/${total}] ${ticker}: ${data.monthly.length} months fetched (${data.startDate} → ${data.endDate})`);
    } catch (err) {
      console.error(`[${String(i + 1).padStart(2, "0")}/${total}] ${ticker}: FAILED — ${err.message}`);
    }
    if (i < total - 1) await sleep(SLEEP_MS);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(prices, null, 2));

  const fetched = Object.keys(prices).length;
  console.log(`\n✓ Wrote ${OUTPUT_PATH} (${fetched}/${total} tickers)`);
  for (const [ticker, data] of Object.entries(prices)) {
    console.log(`  ${ticker}: ${data.startDate} → ${data.endDate} (${data.monthly.length} months)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
