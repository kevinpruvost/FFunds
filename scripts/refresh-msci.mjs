#!/usr/bin/env node
// Refresh the official Net/USD index CSVs, including the current partial month.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DATA = new URL("../src/data/", import.meta.url);
export const INDICES = {
  "msci_world.csv": { code: "990100", name: "MSCI World Index" },
  "world_momentum.csv": { code: "703755", name: "MSCI World Momentum Index" },
  "world_small_cap.csv": { code: "106230", name: "MSCI World Small Cap Index" },
  "world_quality.csv": { code: "702787", name: "MSCI World Quality Index" },
  "world_value.csv": { code: "105868", name: "MSCI World Value Index" },
  "world_consumer_staples.csv": { code: "106800", name: "MSCI World Consumer Staples Index" },
  "world_consumer_discretionary.csv": { code: "106799", name: "MSCI World Consumer Discretionary Index" },
};

export function monthlyLevels(payload, indexCode) {
  if (String(payload.msci_index_code) !== indexCode ||
      payload.index_variant_type !== "NETR" || payload.ISO_currency_symbol !== "USD") {
    throw new Error("Unexpected MSCI index, return variant, or currency");
  }
  const byMonth = new Map();
  // The supplied Momentum export is rebased to 100 on 1997-01-31.
  // MSCI's raw Net/USD level on that date is 313.9175646.
  const scale = indexCode === "703755" ? 100 / 313.9175646 : 1;
  for (const row of payload.indexes?.INDEX_LEVELS ?? []) {
    const rawDate = String(row.calc_date);
    const close = row.level_eod;
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`;
    if (!/^\d{8}$/.test(rawDate) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date ||
        !Number.isFinite(close) || close <= 0) {
      throw new Error("Invalid MSCI date or level");
    }
    const month = date.slice(0, 7);
    if (!byMonth.has(month) || byMonth.get(month).date < date) {
      byMonth.set(month, { date, close: close * scale });
    }
  }
  const monthly = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!monthly.length) throw new Error("MSCI returned no levels");
  return monthly;
}

export function mergeCsv(csv, monthly) {
  const newline = csv.includes("\r\n") ? "\r\n" : "\n";
  const lines = csv.trimEnd().split(/\r?\n/);
  const last = lines.at(-1).split(",");
  const lastDate = last[0];
  const lastMonth = lastDate.slice(0, 7);
  const overlap = monthly.find(row => row.date.slice(0, 7) === lastMonth);
  if (!overlap || overlap.date < lastDate) throw new Error("Missing MSCI overlap with existing history");
  // Same-day overlap must agree with the CSV (allow its decimal rounding).
  if (overlap.date === lastDate && Math.abs(overlap.close / Number(last[1]) - 1) > 1e-6) {
    throw new Error("MSCI overlap disagrees with existing history");
  }
  const additions = monthly.filter(row => row.date.slice(0, 7) >= lastMonth);
  for (let i = 1; i < additions.length; i++) {
    const previous = new Date(`${additions[i - 1].date.slice(0, 7)}-01T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() + 1);
    if (previous.toISOString().slice(0, 7) !== additions[i].date.slice(0, 7)) {
      throw new Error("Gap in MSCI monthly data");
    }
  }
  // Keep completed history byte-for-byte; replace an old month-to-date row.
  if (overlap.date === lastDate) additions.shift();
  else lines.pop();
  return [...lines, ...additions.map(row => `${row.date},${row.close},,,`)].join(newline) + newline;
}

// New series start from their first official level, with the same
// 4-line header as MSCI exports and the same gap checks as later refreshes.
export function newCsv(name, monthly) {
  const [first] = monthly;
  return mergeCsv(`Index Level:,Net\nCurrency:,USD\n\nDate,${name}\n${first.date},${first.close},,,\n`, monthly);
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const updates = [];
  for (const [filename, { code, name }] of Object.entries(INDICES)) {
    const path = new URL(filename, DATA);
    const csv = existsSync(path) ? readFileSync(path, "utf8") : null;
    // MSCI serves no calculation date before 1997-01-01.
    const startDate = csv
      ? csv.trimEnd().split(/\r?\n/).at(-1).split(",")[0].slice(0, 7).replace("-", "") + "01"
      : "19970101";
    const url = new URL("https://app2.msci.com/products/service/index/indexmaster/getLevelDataForGraph");
    url.search = new URLSearchParams({
      currency_symbol: "USD", index_variant: "NETR", data_frequency: "DAILY",
      start_date: startDate, end_date: endDate, index_codes: code,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
    const monthly = monthlyLevels(await response.json(), code);
    try {
      updates.push([path, csv ? mergeCsv(csv, monthly) : newCsv(name, monthly)]);
    } catch (error) {
      throw new Error(`${filename}: ${error.message}`);
    }
    console.log(`${filename}: Net/USD through ${monthly.at(-1).date}`);
  }
  // Validate every index before changing any CSV.
  for (const [path, csv] of updates) writeFileSync(path, csv);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
