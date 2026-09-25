import test from "node:test";
import assert from "node:assert/strict";
import { monthlyLevels, mergeCsv } from "./refresh-msci.mjs";

const payload = rows => ({ msci_index_code: "990100", index_variant_type: "NETR",
  ISO_currency_symbol: "USD", indexes: { INDEX_LEVELS: rows } });
const csv = "Index Level:,Net\nCurrency:,USD\n\nDate,MSCI World Index\n2026-07-31,100,,,\n";

test("daily observations become sorted month ends and latest month-to-date", () => {
  assert.deepEqual(monthlyLevels(payload([
    { calc_date: 20260924, level_eod: 103 }, { calc_date: 20260831, level_eod: 102 },
    { calc_date: 20260901, level_eod: 101 }, { calc_date: 20260803, level_eod: 99 },
  ]), "990100"), [{ date: "2026-08-31", close: 102 }, { date: "2026-09-24", close: 103 }]);
});

test("rejects wrong series, currency, variant, invalid levels and dates", () => {
  const valid = payload([{ calc_date: 20260924, level_eod: 103 }]);
  for (const patch of [{ msci_index_code: "1" }, { ISO_currency_symbol: "EUR" },
    { index_variant_type: "STRD" }, { indexes: {} }]) {
    assert.throws(() => monthlyLevels({ ...valid, ...patch }, "990100"));
  }
  for (const row of [{ calc_date: 20260230, level_eod: 1 },
    { calc_date: 20260924, level_eod: null }, { calc_date: 20260924, level_eod: 0 }]) {
    assert.throws(() => monthlyLevels(payload([row]), "990100"));
  }
});

test("preserves Momentum's original rebasing instead of splicing raw levels", () => {
  const data = { ...payload([{ calc_date: 19970131, level_eod: 313.9175646 },
    { calc_date: 20260731, level_eod: 6605.566759997049 }]), msci_index_code: "703755" };
  const rows = monthlyLevels(data, "703755");
  assert.ok(Math.abs(rows[0].close - 100) < 1e-10);
  // Original export and raw base level have different rounding precision.
  assert.ok(Math.abs(rows[1].close - 2104.236110) < 1e-5);
});

test("preserves history and refreshes partial month without duplicates", () => {
  const rows = [{ date: "2026-07-31", close: 100.00000001 },
    { date: "2026-08-31", close: 102 }, { date: "2026-09-24", close: 103 }];
  const updated = mergeCsv(csv, rows);
  assert.equal(updated, csv + "2026-08-31,102,,,\n2026-09-24,103,,,\n");
  assert.equal(mergeCsv(updated, rows), updated);
  assert.equal(mergeCsv(csv.replaceAll("\n", "\r\n"), rows), updated.replaceAll("\n", "\r\n"));
  const refreshed = mergeCsv(updated, [{ date: "2026-09-25", close: 104 }]);
  assert.equal(refreshed, csv + "2026-08-31,102,,,\n2026-09-25,104,,,\n");
});

test("rejects missing overlap, conflicting levels, gaps, and regressions", () => {
  for (const rows of [[{ date: "2026-08-31", close: 102 }],
    [{ date: "2026-07-31", close: 110 }], [{ date: "2026-07-30", close: 100 }],
    [{ date: "2026-07-31", close: 100 }, { date: "2026-09-24", close: 103 }]]) {
    assert.throws(() => mergeCsv(csv, rows));
  }
});
