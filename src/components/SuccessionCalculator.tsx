import React, { useEffect, useMemo, useState } from "react";
import { calculateSuccession, type AllocationMode, type GrandchildrenTransfer, type OtherRelationship, type SpouseOption } from "../lib/succession";

interface Props {
  T: Record<string, string>;
  isFr: boolean;
}

const money = (value: number, isFr: boolean) => new Intl.NumberFormat(isFr ? "fr-FR" : "en-US", { maximumFractionDigits: 0 }).format(value);
type NumericValue = number | "";
const numericValue = (value: NumericValue) => value === "" ? 0 : value;

export default function SuccessionCalculator({ T, isFr }: Props) {
  const tx = (fr: string, en: string) => isFr ? fr : en;
  const [spouse, setSpouse] = useState(false);
  const [spouseOption, setSpouseOption] = useState<SpouseOption>("quarter");
  const [spouseAge, setSpouseAge] = useState<NumericValue>(65);
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("tax");
  const [children, setChildren] = useState<NumericValue>(3);
  const [grandchildren, setGrandchildren] = useState<NumericValue>(5);
  const [grandchildrenTransfer, setGrandchildrenTransfer] = useState<GrandchildrenTransfer>("testament");
  const [grandchildrenDonationAmount, setGrandchildrenDonationAmount] = useState<NumericValue>(159325);
  const [grandchildrenRepresented, setGrandchildrenRepresented] = useState(false);
  const [otherCount, setOtherCount] = useState<NumericValue>(1);
  const [otherRelationship, setOtherRelationship] = useState<OtherRelationship>("other");
  const [outsideAssets, setOutsideAssets] = useState<NumericValue>(10000);
  const [realEstate, setRealEstate] = useState<NumericValue>(170000);
  const [debts, setDebts] = useState<NumericValue>(0);
  const [avBefore70Total, setAvBefore70Total] = useState<NumericValue>(0);
  const [avAfter70Premiums, setAvAfter70Premiums] = useState<NumericValue>(200000);
  const [avAfter70Gains, setAvAfter70Gains] = useState<NumericValue>(200000);
  const [calculated, setCalculated] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => calculated ? calculateSuccession({
    spouse, spouseOption, spouseAge: numericValue(spouseAge), allocationMode, children: numericValue(children), grandchildren: numericValue(grandchildren), grandchildrenTransfer, grandchildrenDonationAmount: numericValue(grandchildrenDonationAmount), grandchildrenRepresented,
    otherCount: numericValue(otherCount), otherRelationship, outsideAssets: numericValue(outsideAssets), realEstate: numericValue(realEstate), debts: numericValue(debts),
    avBefore70Total: numericValue(avBefore70Total), avAfter70Premiums: numericValue(avAfter70Premiums), avAfter70Gains: numericValue(avAfter70Gains),
  }) : null, [calculated, spouse, spouseOption, spouseAge, allocationMode, children, grandchildren, grandchildrenTransfer, grandchildrenDonationAmount, grandchildrenRepresented, otherCount, otherRelationship, outsideAssets, realEstate, debts, avBefore70Total, avAfter70Premiums, avAfter70Gains]);

  const InputField = (label: string, value: NumericValue, setter: (value: NumericValue) => void, step = 1000, currency = true) => {
    const [local, setLocal] = useState<string>(value === "" ? "" : String(value));

    // Sync local state when external value changes (e.g. cookie load, reset)
    useEffect(() => {
      setLocal(value === "" ? "" : String(value));
    }, [value]);

    const commit = () => {
      if (local === "") { setter(""); return; }
      const parsed = Number(local);
      if (!Number.isFinite(parsed) || parsed < 0) { setLocal(value === "" ? "" : String(value)); return; }
      setter(parsed);
      setLocal(String(parsed));
    };

    return (
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-slate-300">{label}</span>
        <div className="relative">
          {currency && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">€</span>}
          <input
            type="text"
            inputMode={currency ? "decimal" : "numeric"}
            value={local}
            onChange={(event) => setLocal(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => { if (event.key === "Enter") { (event.target as HTMLInputElement).blur(); } }}
            className={`w-full rounded-lg border border-slate-700 bg-slate-800 py-2 ${currency ? "pl-7" : "px-3"} pr-3 text-slate-100 focus:border-rose-500 focus:outline-none`}
          />
        </div>
      </label>
    );
  };

  const calculate = () => {
    const values = [outsideAssets, realEstate, debts, avBefore70Total, avAfter70Premiums, avAfter70Gains, spouseAge, children, grandchildren, grandchildrenDonationAmount, otherCount].map(numericValue);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      setError(T["succ.calc.errors.negative"] || tx("Les valeurs doivent être positives.", "Values must be non-negative."));
      return;
    }
    setError("");
    setCalculated(true);
  };

  const input = InputField;

  return (
    <section>
      <div className="mb-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-100">{T["succ.calc.title"]}</h2>
        <p className="mt-1 text-base text-slate-400">{T["succ.calc.subtitle"]}</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-5 rounded-lg border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
          <strong>{tx("Simulation prudente", "Conservative simulation")}</strong>
          <p className="mt-1 text-amber-200/80">{allocationMode === "equal" ? tx("Chaque bénéficiaire reçoit une part égale. Les donations antérieures, testaments, régime matrimonial et clauses bénéficiaires doivent être vérifiés avec un notaire.", "Each beneficiary receives an equal share. Prior gifts, wills, matrimonial regime and beneficiary clauses require a notary review.") : tx("Les tranches les moins taxées sont utilisées en priorité, puis chaque tranche de même taux est répartie équitablement. Cette simulation ne peut pas contourner la réserve héréditaire.", "The lowest tax brackets are used first, then each equal-rate tranche is shared fairly. This simulation cannot override reserved-heir rules.")}</p>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          <div className="space-y-2">
            <span className="block text-sm font-medium text-slate-300">{tx("Conjoint marié / partenaire PACS", "Married spouse / PACS partner")}</span>
            <div className="flex gap-2">
              {[true, false].map((value) => <button key={String(value)} type="button" onClick={() => setSpouse(value)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${spouse === value ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{value ? tx("Oui", "Yes") : tx("Non", "No")}</button>)}
            </div>
          </div>
          {spouse && (children > 0 || grandchildren > 0) && <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">{tx("Option successorale", "Spouse inheritance option")}</label>
            <select value={spouseOption} onChange={(event) => setSpouseOption(event.target.value as SpouseOption)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100">
              <option value="quarter">{tx("1/4 en pleine propriété", "1/4 full ownership")}</option>
              <option value="usufruit">{tx("Usufruit de la totalité", "Usufruct of the whole estate")}</option>
            </select>
          </div>}
          {spouse && spouseOption === "usufruit" && input(tx("Âge du conjoint usufruitier", "Spouse usufructuary age"), spouseAge, setSpouseAge, 1, false)}
          <label className="space-y-1.5"><span className="block text-sm font-medium text-slate-300">{tx("Mode de répartition", "Allocation mode")}</span><select value={allocationMode} onChange={(event) => setAllocationMode(event.target.value as AllocationMode)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="equal">{tx("Répartition égale", "Equal allocation")}</option><option value="tax">{tx("Optimisation fiscale — équitable", "Tax optimization — fair")}</option></select>{allocationMode === "tax" && <span className="block text-xs text-slate-500">{tx("À impôt minimal égal, les montants sont nivelés entre les bénéficiaires.", "When the minimum tax is the same, amounts are leveled across beneficiaries.")}</span>}</label>
          {input(tx("Enfants vivants", "Living children"), children, setChildren, 1, false)}
          {input(tx(grandchildrenTransfer === "donation" ? "Petits-enfants bénéficiaires" : "Petits-enfants héritiers", grandchildrenTransfer === "donation" ? "Grandchildren receiving a gift" : "Grandchildren inheriting"), grandchildren, setGrandchildren, 1, false)}
          {grandchildren > 0 && <label className="space-y-1.5"><span className="block text-sm font-medium text-slate-300">{tx("Mode de transmission des petits-enfants", "Grandchildren transfer mode")}</span><select value={grandchildrenTransfer} onChange={(event) => setGrandchildrenTransfer(event.target.value as GrandchildrenTransfer)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="testament">{tx("Testament (abattement succession)", "Will (inheritance allowance)")}</option><option value="donation">{tx("Donation (abattement donation)", "Gift (donation allowance)")}</option></select></label>}
          {grandchildren > 0 && grandchildrenTransfer === "donation" && <div className="space-y-1.5"><div>{input(tx("Montant total donné aux petits-enfants", "Total amount gifted to grandchildren"), grandchildrenDonationAmount, setGrandchildrenDonationAmount)}</div><p className="text-xs text-slate-500">{tx("Le simulateur retire d'abord ce montant de l'AV, calcule la fiscalité des gains retirés, puis répartit le don à parts égales.", "The simulator first withdraws this amount from life insurance, taxes the withdrawn gains, then splits the gift equally.")}</p></div>}
          {grandchildren > 0 && grandchildrenTransfer === "testament" && <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={grandchildrenRepresented} onChange={(event) => setGrandchildrenRepresented(event.target.checked)} className="accent-rose-600" />{tx("Ils représentent un enfant prédécédé/renonçant", "They represent a predeceased/renouncing child")}</label>}

          <div className="col-span-full border-t border-slate-700/60 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{tx("Actif net", "Net estate")}</p></div>
          {input(tx("Actifs financiers et liquidités", "Financial assets and cash"), outsideAssets, setOutsideAssets)}
          {input(tx("Immobilier", "Real estate"), realEstate, setRealEstate, 10000)}
          {input(tx("Dettes à déduire", "Debts to deduct"), debts, setDebts)}

          <div className="col-span-full border-t border-slate-700/60 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assurance-vie</p><p className="mt-1 text-xs text-slate-500">{tx("Séparez les versements selon l'âge au moment du versement.", "Separate premiums by the age when they were paid.")}</p></div>
          {input(tx("Capital décès lié aux versements avant 70 ans", "Death benefit from premiums paid before age 70"), avBefore70Total, setAvBefore70Total)}
          {input(tx("Primes versées après 70 ans", "Premiums paid after age 70"), avAfter70Premiums, setAvAfter70Premiums)}
          {input(tx("Gains liés aux primes après 70 ans", "Gains on premiums paid after age 70"), avAfter70Gains, setAvAfter70Gains)}

          <div className="col-span-full border-t border-slate-700/60 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{tx("Bénéficiaires hors descendants", "Non-descendant beneficiaries")}</p></div>
          {input(tx("Nombre de bénéficiaires", "Number of beneficiaries"), otherCount, setOtherCount, 1, false)}
          <label className="space-y-1.5"><span className="block text-sm font-medium text-slate-300">{tx("Lien de parenté", "Relationship")}</span><select value={otherRelationship} onChange={(event) => setOtherRelationship(event.target.value as OtherRelationship)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"><option value="sibling">{tx("Frère / sœur", "Sibling")}</option><option value="nephew">{tx("Neveu / nièce", "Nephew / niece")}</option><option value="other">{tx("Autre / non-parent", "Other / unrelated")}</option></select></label>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex justify-center"><button type="button" onClick={calculate} className="rounded-lg bg-rose-600 px-8 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-rose-500">{calculated ? (T["succ.calc.btnAlt"] || tx("Recalculer", "Recalculate")) : (T["succ.calc.btn"] || tx("Calculer", "Calculate"))}</button></div>
      </div>

      {result && <div className="mt-6 space-y-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6"><h3 className="mb-4 text-base font-semibold text-slate-100">{T["succ.calc.result.title"]}</h3><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[[tx("Patrimoine brut", "Gross estate"), result.totalEstate, "text-slate-100"], [tx("Droits estimés", "Estimated tax"), result.totalTax, "text-rose-400"], [tx("Net transmis", "Net transferred"), result.net, "text-emerald-400"]].map(([label, value, color]) => <div key={String(label)} className="rounded-lg bg-slate-800/60 p-4"><p className="text-xs text-slate-400">{label}</p><p className={`mt-1 text-xl font-bold ${color}`}>€{money(Number(value), isFr)}</p></div>)}<div className="rounded-lg bg-slate-800/60 p-4"><p className="text-xs text-slate-400">{T["succ.calc.result.effectiveRate"]}</p><p className="mt-1 text-xl font-bold text-slate-100">{result.effective}</p></div></div>{result.lifetimeDonationGross > 0 && <div className="mt-4 grid gap-3 rounded-lg border border-amber-800/50 bg-amber-950/20 p-4 text-sm md:grid-cols-2"><div><p className="text-xs text-amber-200/70">{tx("Donné avant le décès", "Gifted before death")}</p><p className="mt-1 font-semibold text-amber-100">€{money(result.lifetimeDonationGross, isFr)}</p></div><div><p className="text-xs text-amber-200/70">{tx("Actif restant au décès", "Estate remaining at death")}</p><p className="mt-1 font-semibold text-amber-100">€{money(result.estateAtDeath, isFr)}</p></div><p className="col-span-full text-xs text-amber-200/70">{tx("Le total des droits inclut la fiscalité éventuelle du retrait des gains AV et les droits de donation.", "Total tax includes any tax on withdrawn life-insurance gains and gift tax.")}</p></div>}</div>

        {result.warnings.length > 0 && <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-5"><h3 className="mb-2 text-sm font-semibold text-amber-200">{tx("À vérifier", "Review required")}</h3><ul className="list-disc space-y-1 pl-5 text-sm text-amber-200/80">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6"><h3 className="mb-4 text-base font-semibold text-slate-100">{T["succ.calc.detail.title"]}</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left">{T["succ.calc.detail.asset"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.gross"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.allowance"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.taxable"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.rate"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.tax"]}</th></tr></thead><tbody>{result.rows.map((row) => <tr key={`${row.label}-${row.gross}`} className="border-b border-slate-800 text-slate-300"><td className="px-3 py-2">{row.label}</td><td className="px-3 py-2 text-right">€{money(row.gross, isFr)}</td><td className="px-3 py-2 text-right text-slate-400">€{money(row.allowance, isFr)}</td><td className="px-3 py-2 text-right text-slate-400">€{money(row.taxable, isFr)}</td><td className="px-3 py-2 text-right text-slate-400">{row.rate}</td><td className="px-3 py-2 text-right font-semibold text-rose-400">€{money(row.tax, isFr)}</td></tr>)}<tr className="border-t border-slate-600 font-bold text-slate-100"><td className="px-3 py-2">{T["succ.calc.detail.full"]}</td><td className="px-3 py-2 text-right">€{money(result.totalEstate, isFr)}</td><td colSpan={3}></td><td className="px-3 py-2 text-right text-rose-400">€{money(result.totalTax, isFr)}</td></tr></tbody></table></div></div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6"><h3 className="mb-4 text-base font-semibold text-slate-100">{tx("Détail par bénéficiaire", "Per-beneficiary detail")}</h3><p className="mb-3 text-xs text-slate-500">{tx("Assiette successorale classique et primes après 70 ans, hors clause bénéficiaire AV avant 70 ans.", "Standard estate base and after-70 premiums, excluding the before-70 life-insurance beneficiary clause.")}</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2 text-left">{tx("Personne", "Person")}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.gross"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.allowance"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.taxable"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.tax"]}</th><th className="px-3 py-2 text-right">{tx("Donation reversée", "Gift forwarded")}</th><th className="px-3 py-2 text-right">{tx("Net conservé", "Net retained")}</th></tr></thead><tbody>{result.beneficiaries.map((person) => <tr key={person.id} className="border-b border-slate-800 text-slate-300"><td className="px-3 py-2"><span className="font-medium text-slate-100">{person.name}</span><span className="ml-2 text-xs text-slate-500">{person.relationship}</span></td><td className="px-3 py-2 text-right">€{money(person.gross, isFr)}</td><td className="px-3 py-2 text-right text-slate-400">€{money(person.allowance, isFr)}</td><td className="px-3 py-2 text-right text-slate-400">€{money(person.taxable, isFr)}</td><td className="px-3 py-2 text-right text-rose-400">€{money(person.tax, isFr)}</td><td className="px-3 py-2 text-right text-amber-300">€{money(person.donationsOut, isFr)}</td><td className="px-3 py-2 text-right font-semibold text-emerald-400">€{money(person.net, isFr)}</td></tr>)}</tbody></table></div></div>

        {result.transferPlan.length > 0 && <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-6"><h3 className="mb-2 text-base font-semibold text-emerald-200">{tx("Parcours de transmission", "Transfer path")}</h3><p className="mb-4 text-xs text-emerald-200/70">{tx("Chaque étape est isolée : retrait éventuel de l'AV, héritage, puis donation et abattement utilisés.", "Each step is shown separately: any life-insurance withdrawal, inheritance, then gift and allowance used.")}</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-emerald-800/50 text-xs uppercase tracking-wide text-emerald-300/70"><th className="px-3 py-2 text-left">{tx("De → vers", "From → to")}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.gross"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.allowance"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.taxable"]}</th><th className="px-3 py-2 text-right">{T["succ.calc.detail.tax"]}</th><th className="px-3 py-2 text-right">{tx("Net reçu", "Net received")}</th></tr></thead><tbody>{result.transferPlan.map((step) => <tr key={step.id} className="border-b border-emerald-900/40 text-emerald-50/90"><td className="px-3 py-2">{step.from} → {step.to}</td><td className="px-3 py-2 text-right">€{money(step.gross, isFr)}</td><td className="px-3 py-2 text-right text-emerald-200/70">€{money(step.allowance, isFr)}</td><td className="px-3 py-2 text-right text-emerald-200/70">€{money(step.taxable, isFr)}</td><td className="px-3 py-2 text-right text-rose-300">€{money(step.tax, isFr)}</td><td className="px-3 py-2 text-right font-semibold text-emerald-300">€{money(step.net, isFr)}</td></tr>)}</tbody></table></div></div>}
      </div>}
    </section>
  );
}
