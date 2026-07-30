import { useEffect, useMemo, useState } from "react";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

type Mode = "comptes" | "banques";
type TabKey = "ctoPea" | "brokers" | "margin" | "banksFr" | "banksEu" | "banksWorld";

interface ComptesBanquesProps {
  mode: Mode;
}

const BROKERS = [
  "ibkr",
  "saxo",
  "boursedirect",
  "fortuneo",
  "boursobank",
  "traderepublic",
  "degiro",
] as const;

const BANKS_FR = ["boursobank", "fortuneo", "hellobank", "monabanq", "bnp", "ca"] as const;
const BANKS_EU = ["revolut", "wise", "n26", "bunq", "hsbceurope", "bnpbe"] as const;
const BANKS_WORLD = ["wise", "hsbcpremier", "ibkr", "dbs", "ubs", "charlesschwab"] as const;

// ── Sources map (clickable external-link icons) ──
// Deep links to the exact page carrying the cited figure (tariff, fiscalité, ranking).
// URLs verified 200 via curl or websearch 2026-07. #:~:text= highlights jump to the cited sentence.
const SOURCES = {
  // Tax / fiscalité (CTO + PEA) — official articles with the cited rate/sentence
  servicePublicPfu: "https://www.service-public.gouv.fr/particuliers/vosdroits/F2382#:~:text=pr%C3%A9l%C3%A8vement%20forfaitaire%20unique%20(PFU)%20de%2030%20%25",
  servicePublicPV: "https://www.service-public.gouv.fr/particuliers/vosdroits/F21618#:~:text=pr%C3%A9l%C3%A8vement%20forfaitaire%20unique%20au%20taux%20de%2031%2C4%20%25",
  servicePublicPea: "https://www.service-public.gouv.fr/particuliers/vosdroits/F22449#:~:text=gains%20exon%C3%A9r%C3%A9s%20d%27imp%C3%B4t%20sur%20le%20revenu",
  impotsRCM: "https://www.impots.gouv.fr/particulier/revenus-de-capitaux-mobiliers#:~:text=Plus-values%20de%20cession%20%C3%A0%20titre%20on%C3%A9reux",
  amfCto: "https://www.amf-france.org/fr/espace-epargnants/comprendre-les-produits-financiers/supports-dinvestissement/compte-titres#:~:text=soumis%20%C3%A0%20l%27imposition%20des%20revenus%20de%20valeurs%20mobili%C3%A8res",
  amfPea: "https://www.amf-france.org/fr/espace-epargnants/comprendre-les-produits-financiers/supports-dinvestissement/pea#:~:text=fiscalit%C3%A9%20avantageuse",
  economiePea: "https://www.economie.gouv.fr/particuliers/plan-epargne-actions-pea#:~:text=gains%20exon%C3%A9r%C3%A9s%20d%27imp%C3%B4t%20sur%20le%20revenu",
  // Brokers — official tariff/grille tarifaire page with the cited fee
  boursedirect: "https://www.boursedirect.fr/fr/bourse/tarifs#:~:text=0%2C99%20%E2%82%AC%20l%E2%80%99ordre%20de%20bourse%20jusqu%E2%80%99%C3%A0%20500%20%E2%82%AC%20inclus",
  boursedirectPdf: "https://www.boursedirect.fr/pdf/tarifs_bd.pdf#:~:text=0%2C036%25%20annuel",
  fortuneo: "https://www.fortuneo.fr/bourse/offres#:~:text=0%2C35%20%25%20par%20ordre",
  boursobank: "https://www.boursobank.com/aide-en-ligne/bourse/comment-investir-en-bourse/fonctionnement-de-la-bourse/question/quels-sont-les-frais-de-courtage-chez-boursobank-17227195#:~:text=quatre%20forfaits%20diff%C3%A9rents",
  traderepublic: "https://traderepublic.com/fr-fr/pea#:~:text=PEA",
  degiro: "https://www.degiro.fr/tarifs#:~:text=Euronext%20Paris",
  degiroPdf: "https://www.degiro.nl/data/pdf/fr/Tarifs.pdf#:~:text=S%C3%A9lection%20principale%20d%E2%80%99ETF%200%2C00%E2%82%AC",
  saxo: "https://www.home.saxo/fr-fr/rates-and-conditions/stocks/commissions#:~:text=Classic",
  saxoOverview: "https://www.home.saxo/fr-fr/rates-and-conditions/pricing-overview#:~:text=Commissions%20%C3%A0%20partir%20de%202%E2%82%AC",
  ibkr: "https://www.interactivebrokers.ie/fr/accounts/plan-depargne-en-action-accounts.php#:~:text=Les%20r%C3%A9sidents%20fiscaux%20fran%C3%A7ais%20peuvent%20ouvrir%20un%20PEA",
  // Banks FR — official tarif page with the cited fee
  fortuneoBankFr: "https://www.fortuneo.fr/bourse/offres#:~:text=0%2C35%20%25%20par%20ordre",
  hellobank: "https://www.hellobank.fr/fr/offre/bourse/offres-et-tarifications/#:~:text=1%2C75%20%E2%82%AC%20par%20ordre%20jusqu%E2%80%99%C3%A0%20500%20%E2%82%AC%20inclus",
  monabanq: "https://www.monabanq.com/fr/produits-bancaires/cto/en-resume.html#:~:text=Frais%20de%20courtage",
  bnp: "https://www.bnpparibas.net/particuliers/consulter-nos-tarifs",
  ca: "https://www.creditagricole.fr/particulier/nous-contacter/tarifs.html",
  // Banks EU — official pricing page
  revolut: "https://www.revolut.com/fr-FR/our-pricing-plans/#:~:text=Standard%2CPlus%2CPremium%2CMetal%2CUltra",
  wise: "https://wise.com/fr/pricing#:~:text=envoyer%20de%20l%27argent",
  n26: "https://n26.com/fr-fr/tarifs#:~:text=Standard%2CSmart%2CGo%2CMetal",
  bunq: "https://www.bunq.com/plans#:~:text=Easy%20Savings",
  hsbceurope: "https://www.privatebanking.hsbc.fr/",
  bnpbe: "https://www.bnpparibasfortis.be/fr/public/liste-tarifs#:~:text=Liste%20des%20tarifs",
  // Banks World
  hsbcpremier: "https://www.privatebanking.hsbc.fr/",
  ibkrBank: "https://www.interactivebrokers.ie/fr/accounts/plan-depargne-en-action-accounts.php#:~:text=Les%20r%C3%A9sidents%20fiscaux%20fran%C3%A7ais%20peuvent%20ouvrir%20un%20PEA",
  dbs: "https://www.dbs.com.sg/treasures/rates-fees#:~:text=Rates%20%26%20Fees",
  ubs: "https://www.ubs.com/ch/en/services/wealth-management/private-banking.html#:~:text=Private%20Banking",
  charlesschwab: "https://www.schwab.com/pricing#:~:text=Online%20equity%20commissions",
} as const;

// ── Source icon component ──
function Src({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label || href}
      className="ml-1.5 inline-flex items-center align-baseline text-slate-500 hover:text-orange-400 transition-colors"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

function ComptesBanquesInner({ mode }: ComptesBanquesProps) {
  const { t } = useI18n();
  const COMPTES_TABS: { key: TabKey; labelKey: string }[] = [
    { key: "ctoPea", labelKey: "cb.tab.ctoPea" },
    { key: "brokers", labelKey: "cb.tab.brokers" },
    { key: "margin", labelKey: "cb.tab.margin" },
  ];
  const BANQUES_TABS: { key: TabKey; labelKey: string }[] = [
    { key: "banksFr", labelKey: "cb.tab.banks.fr" },
    { key: "banksEu", labelKey: "cb.tab.banks.eu" },
    { key: "banksWorld", labelKey: "cb.tab.banks.world" },
  ];
  const TABS = mode === "comptes" ? COMPTES_TABS : BANQUES_TABS;
  const [tab, setTab] = useState<TabKey>(TABS[0].key);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && TABS.some((tabDef) => tabDef.key === hash)) {
      setTab(hash as TabKey);
    }
  }, []);

  // ── CTO/PEA tab ──
  const CtoPeaTab = () => (
    <div className="space-y-6">
      {/* Intro compare note */}
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
        <h3 className="mb-2 text-base font-semibold text-amber-300">{t("cb.compare.title")}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">{t("cb.compare.note")}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* CTO card */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="mb-2 text-lg font-semibold text-slate-100">{t("cb.cto.title")}</h3>
          <p className="mb-4 text-sm text-slate-400 leading-relaxed">{t("cb.cto.desc")}</p>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            {t("cb.cto.benefits")}
          </h4>
          <ul className="mb-4 space-y-1.5 text-sm text-slate-400">
            {[1, 2, 3].map((i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{t(`cb.cto.b${i}`)}</span>
              </li>
            ))}
          </ul>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-400">
            {t("cb.cto.cons")}
          </h4>
          <ul className="mb-4 space-y-1.5 text-sm text-slate-400">
            {[1, 2, 3].map((i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <span>{t(`cb.cto.c${i}`)}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-md border border-slate-700/50 bg-slate-800/30 p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              {t("cb.cto.tax")}
            </h4>
            <ul className="space-y-2 text-xs text-slate-300">
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                <span>
                  {t("cb.cto.t1")}
                  <Src href={SOURCES.servicePublicPV} label="service-public.gouv.fr" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                <span>
                  {t("cb.cto.t2")}
                  <Src href={SOURCES.impotsRCM} label="impots.gouv.fr" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                <span>
                  {t("cb.cto.t3")}
                  <Src href={SOURCES.impotsRCM} label="impots.gouv.fr" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                <span>
                  {t("cb.cto.t4")}
                  <Src href={SOURCES.servicePublicPV} label="service-public.gouv.fr" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                <span>
                  {t("cb.cto.t5")}
                  <Src href={SOURCES.impotsRCM} label="impots.gouv.fr" />
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* PEA card */}
        <section className="rounded-xl border border-emerald-800/40 bg-emerald-950/10 p-5">
          <h3 className="mb-2 text-lg font-semibold text-emerald-200">{t("cb.pea.title")}</h3>
          <p className="mb-4 text-sm text-slate-400 leading-relaxed">{t("cb.pea.desc")}</p>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            {t("cb.pea.benefits")}
          </h4>
          <ul className="mb-4 space-y-1.5 text-sm text-slate-400">
            {[1, 2, 3].map((i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{t(`cb.pea.b${i}`)}</span>
              </li>
            ))}
          </ul>

          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-400">
            {t("cb.pea.cons")}
          </h4>
          <ul className="mb-4 space-y-1.5 text-sm text-slate-400">
            {[1, 2, 3, 4].map((i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <span>{t(`cb.pea.c${i}`)}</span>
              </li>
            ))}
          </ul>

          <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-900/20 p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-200">
              {t("cb.pea.tax")}
            </h4>
            <ul className="space-y-2 text-xs text-emerald-100">
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  {t("cb.pea.t1")}
                  <Src href={SOURCES.economiePea} label="economie.gouv.fr" />
                  <Src href={SOURCES.amfPea} label="amf-france.org" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  {t("cb.pea.t2")}
                  <Src href={SOURCES.servicePublicPea} label="service-public.gouv.fr" />
                </span>
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  {t("cb.pea.t3")}
                  <Src href={SOURCES.servicePublicPea} label="service-public.gouv.fr" />
                </span>
              </li>
            </ul>
          </div>
          <div className="mb-2 text-xs text-slate-500">{t("cb.pea.pme")}</div>
          <div className="text-xs text-slate-500">{t("cb.pea.young")}</div>
        </section>
      </div>
    </div>
  );

  // ── Brokers tab ──
  const BrokersTab = () => (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400/80 leading-relaxed">
        {t("cb.brokers.note")}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/60">
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.brokers.col.broker")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.brokers.col.accounts")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.brokers.col.order500")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.brokers.col.orderBig")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.brokers.col.custody")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.brokers.col.fx")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.brokers.col.pea")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 min-w-[12rem]">{t("cb.brokers.col.pros")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 min-w-[8rem]">{t("cb.brokers.col.bestFor")}</th>
            </tr>
          </thead>
          <tbody>
            {BROKERS.map((b) => (
              <tr key={b} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors align-top">
                <td className="px-3 py-3 font-medium text-slate-100">
                  {t(`cb.brokers.${b}.name`)}
                  <Src href={SOURCES[b as keyof typeof SOURCES]} label={SOURCES[b as keyof typeof SOURCES]} />
                </td>
                <td className="px-3 py-3 text-slate-400">{t(`cb.brokers.${b}.accounts`)}</td>
                <td className="px-3 py-3 text-slate-300 tabular-nums">{t(`cb.brokers.${b}.order500`)}</td>
                <td className="px-3 py-3 text-slate-300 tabular-nums">{t(`cb.brokers.${b}.orderBig`)}</td>
                <td className="px-3 py-3 text-emerald-400 tabular-nums">{t(`cb.brokers.${b}.custody`)}</td>
                <td className="px-3 py-3 text-slate-400">{t(`cb.brokers.${b}.fx`)}</td>
                <td className="px-3 py-3 text-slate-300">{t(`cb.brokers.${b}.pea`)}</td>
                <td className="px-3 py-3 text-slate-400 leading-relaxed">{t(`cb.brokers.${b}.pros`)}</td>
                <td className="px-3 py-3 text-slate-500 italic leading-relaxed">{t(`cb.brokers.${b}.bestFor`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── Margin loans tab ──
  const LiqCalc = () => {
    const { t } = useI18n();
    const [equityStr, setEquityStr] = useState("50000");
    const [lev, setLev] = useState(2);
    const [mm, setMm] = useState(30);

    const equity = Math.max(100, parseFloat(equityStr) || 0);
    const total = equity * lev;
    const loan = total - equity;
    const liqPrice = mm < 100 ? loan / (1 - mm / 100) : 0;
    const maxDropPct = total > 0 ? (1 - liqPrice / total) * 100 : 0;
    const isLiquidating = liqPrice >= total;

    return (
      <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-500">{t("cb.margin.liqCalc.equity")}</label>
            <input
              type="text"
              inputMode="numeric"
              value={equityStr}
              onChange={(e) => setEquityStr(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => { const v = parseFloat(equityStr) || 0; setEquityStr(Math.max(100, Math.min(10000000, v)).toString()); }}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 tabular-nums focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-500">{t("cb.margin.liqCalc.leverage")}: <span className="text-amber-300 tabular-nums">{lev.toFixed(1)}x</span></label>
            <input type="range" min="1" max="5" step="0.5" value={lev} onChange={(e) => setLev(parseFloat(e.target.value))} className="w-full accent-amber-500" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-500">{t("cb.margin.liqCalc.maintMargin")}: <span className="text-amber-300 tabular-nums">{mm}%</span></label>
            <input type="range" min="10" max="50" step="1" value={mm} onChange={(e) => setMm(parseInt(e.target.value))} className="w-full accent-amber-500" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-md border border-slate-700/50 bg-slate-800/30 p-2">
            <div className="text-[10px] text-slate-500">{t("cb.margin.liqCalc.total")}</div>
            <div className="text-sm font-semibold text-slate-200 tabular-nums">{total.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>
          </div>
          <div className="rounded-md border border-slate-700/50 bg-slate-800/30 p-2">
            <div className="text-[10px] text-slate-500">{t("cb.margin.liqCalc.loan")}</div>
            <div className="text-sm font-semibold text-amber-300 tabular-nums">{loan.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>
          </div>
          <div className={`rounded-md border p-2 ${isLiquidating ? "border-rose-700/50 bg-rose-950/30" : "border-rose-700/40 bg-rose-950/20"}`}>
            <div className="text-[10px] text-slate-500">{t("cb.margin.liqCalc.liqPrice")}</div>
            <div className="text-sm font-semibold text-rose-300 tabular-nums">{liqPrice.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>
          </div>
          <div className="rounded-md border border-rose-700/40 bg-rose-950/20 p-2">
            <div className="text-[10px] text-slate-500">{t("cb.margin.liqCalc.maxDrop")}</div>
            <div className="text-sm font-semibold text-rose-300 tabular-nums">{maxDropPct.toFixed(1)}%</div>
          </div>
          <div className={`rounded-md border p-2 ${isLiquidating ? "border-rose-700/50 bg-rose-950/30" : "border-emerald-700/40 bg-emerald-950/20"}`}>
            <div className="text-[10px] text-slate-500">{t("cb.margin.liqCalc.status")}</div>
            <div className={`text-xs font-semibold ${isLiquidating ? "text-rose-400" : "text-emerald-300"}`}>
              {isLiquidating ? t("cb.margin.liqCalc.liquidated") : t("cb.margin.liqCalc.safe")}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const MarginTab = () => {
    // Local simulator state — clamps on blur/Enter only (same pattern as StepCard/InputField)
    const [equityStr, setEquityStr] = useState("10000");
    const [leverage, setLeverage] = useState(2);
    const [loanRate, setLoanRate] = useState(4);
    const [maintMargin, setMaintMargin] = useState(30);
    const [annualReturn, setAnnualReturn] = useState(8);
    const [years, setYears] = useState(10);
    const [maxDrawdown, setMaxDrawdown] = useState(10);
    const [drawdownYear, setDrawdownYear] = useState(2);
    const [releverageMode, setReleverageMode] = useState<"none" | "gains-only" | "bidirectional">("bidirectional");

    const equity = parseFloat(equityStr) || 0;
    const initialLoan = equity * (leverage - 1);
    const initialTotal = equity * leverage;
    const targetLoanRatio = leverage > 0 ? (leverage - 1) / leverage : 0;

    // Liquidation price: V_liq = D / (1 - MM)
    const liquidationValue = maintMargin < 100 ? initialLoan / (1 - maintMargin / 100) : 0;
    const liquidationDropPct = initialTotal > 0 ? (1 - liquidationValue / initialTotal) * 100 : 0;

    // Monthly simulation with forced drawdown + re-leverage modes
    const monthlyProjection = useMemo(() => {
      const rows: { monthIdx: number; year: number; month: number; label: string; portfolioValue: number; loan: number; equity: number; interestPaid: number; status: "safe" | "warning" | "liquidated"; drawdownApplied: boolean }[] = [];
      let portfolioValue = initialTotal;
      let loan = initialLoan;
      let totalInterest = 0;
      const monthlyReturn = Math.pow(1 + annualReturn / 100, 1 / 12) - 1;
      const monthlyInterestRate = loanRate / 100 / 12;
      let drawdownApplied = false;
      let liquidated = false;

      for (let y = 1; y <= years && !liquidated; y++) {
        for (let m = 1; m <= 12 && !liquidated; m++) {
          const monthIdx = (y - 1) * 12 + m;

          // Forced drawdown: apply once at the start of drawdownYear
          if (!drawdownApplied && y >= drawdownYear && m === 1) {
            portfolioValue = portfolioValue * (1 - maxDrawdown / 100);
            drawdownApplied = true;
          }

          // Normal monthly growth (only if not the drawdown month)
          if (!(drawdownApplied && y === drawdownYear && m === 1)) {
            portfolioValue = portfolioValue * (1 + monthlyReturn);
          }

          // Interest accrues on loan (capitalized monthly)
          const monthlyInterest = loan * monthlyInterestRate;
          totalInterest += monthlyInterest;
          loan = loan + monthlyInterest;

          let currentEquity = portfolioValue - loan;
          const maintenanceThreshold = (maintMargin / 100) * portfolioValue;

          // Liquidation check
          if (currentEquity <= maintenanceThreshold || currentEquity <= 0) {
            rows.push({ monthIdx, year: y, month: m, label: `Y${y}M${m}`, portfolioValue, loan, equity: currentEquity, interestPaid: totalInterest, status: "liquidated", drawdownApplied });
            liquidated = true;
            break;
          }

          // Re-leverage adjustment (after growth + interest, before next month)
          if (releverageMode !== "none" && leverage > 1) {
            const targetLoan = portfolioValue * targetLoanRatio;
            if (releverageMode === "bidirectional") {
              loan = targetLoan;
            } else if (releverageMode === "gains-only" && targetLoan > loan) {
              loan = targetLoan;
            }
          }
          currentEquity = portfolioValue - loan;

          let status: "safe" | "warning" | "liquidated" = "safe";
          if (currentEquity <= maintenanceThreshold * 1.2) {
            status = "warning";
          }
          rows.push({ monthIdx, year: y, month: m, label: `Y${y}M${String(m).padStart(2, "0")}`, portfolioValue, loan, equity: currentEquity, interestPaid: totalInterest, status, drawdownApplied });
        }
      }
      return rows;
    }, [initialTotal, initialLoan, annualReturn, loanRate, maintMargin, years, maxDrawdown, drawdownYear, releverageMode, leverage, targetLoanRatio]);

    // Yearly projection derived from monthly rows (for summary cards)
    const projection = useMemo(() => {
      const byYear = new Map<number, { year: number; monthIdx: number; portfolioValue: number; loan: number; equity: number; interestPaid: number; status: "safe" | "warning" | "liquidated"; drawdownApplied: boolean }>();
      for (const r of monthlyProjection) {
        const existing = byYear.get(r.year);
        if (!existing || r.monthIdx > existing.monthIdx || r.status === "liquidated") {
          byYear.set(r.year, { year: r.year, monthIdx: r.monthIdx, portfolioValue: r.portfolioValue, loan: r.loan, equity: r.equity, interestPaid: r.interestPaid, status: r.status, drawdownApplied: r.drawdownApplied });
        }
      }
      return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
    }, [monthlyProjection]);

    const finalRow = projection[projection.length - 1];
    const isLiquidated = finalRow?.status === "liquidated";
    const liquidationYear = projection.find((r) => r.status === "liquidated")?.year;
    const RELEV_MODES: { key: "none" | "gains-only" | "bidirectional"; labelKey: string }[] = [
      { key: "none", labelKey: "cb.margin.sim.relevNone" },
      { key: "gains-only", labelKey: "cb.margin.sim.relevGains" },
      { key: "bidirectional", labelKey: "cb.margin.sim.relevBi" },
    ];

    const SimParam = ({ helpKey, label, children }: { helpKey: string; label: React.ReactNode; children: React.ReactNode }) => (
      <div className="group relative">
        <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
        {children}
        <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-56 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-300 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
          {t(helpKey)}
        </span>
      </div>
    );

    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-orange-800/40 bg-orange-950/15 p-5">
          <h3 className="mb-2 text-base font-semibold text-orange-300">{t("cb.margin.title")}</h3>
          <p className="mb-3 text-sm text-slate-300 leading-relaxed">{t("cb.margin.intro")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">{t("cb.margin.howItWorks")}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{t("cb.margin.howItWorksDesc")}</p>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-rose-400">{t("cb.margin.risks")}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{t("cb.margin.risksDesc")}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { key: "equity", title: t("cb.margin.concept.equity"), desc: t("cb.margin.concept.equityDesc") },
            { key: "maintenance", title: t("cb.margin.concept.maintenance"), desc: t("cb.margin.concept.maintenanceDesc") },
            { key: "call", title: t("cb.margin.concept.call"), desc: t("cb.margin.concept.callDesc") },
          ].map((c) => (
            <div key={c.key} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="mb-1.5 text-sm font-semibold text-slate-100">{c.title}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-indigo-800/40 bg-indigo-950/15 p-5">
          <h3 className="mb-3 text-base font-semibold text-indigo-300">{t("cb.margin.regTvsPm.title")}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
              <h4 className="mb-2 text-sm font-semibold text-slate-100">{t("cb.margin.regT.title")}</h4>
              <ul className="space-y-1.5 text-xs text-slate-400">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex gap-2 leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                    <span>{t(`cb.margin.regT.${i}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-indigo-700/40 bg-indigo-900/20 p-4">
              <h4 className="mb-2 text-sm font-semibold text-indigo-200">{t("cb.margin.pm.title")}</h4>
              <ul className="space-y-1.5 text-xs text-slate-400">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex gap-2 leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                    <span>{t(`cb.margin.pm.${i}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">{t("cb.margin.regTvsPm.note")}</p>
        </div>

        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
          <h4 className="mb-2 text-sm font-semibold text-amber-300">{t("cb.margin.formula.title")}</h4>
          <div className="mb-2 rounded-md bg-slate-900/60 p-3 font-mono text-xs text-slate-300">
            {t("cb.margin.formula.eq")}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{t("cb.margin.formula.explain")}</p>

          <LiqCalc />
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-100">{t("cb.margin.sim.title")}</h3>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SimParam helpKey="cb.margin.sim.equity.help" label={t("cb.margin.sim.equity")}>
              <input
                type="text"
                inputMode="numeric"
                value={equityStr}
                onChange={(e) => setEquityStr(e.target.value.replace(/[^0-9.]/g, ""))}
                onBlur={() => {
                  const v = parseFloat(equityStr) || 0;
                  setEquityStr(Math.max(100, Math.min(10000000, v)).toString());
                }}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 tabular-nums focus:border-orange-500 focus:outline-none"
              />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.leverage.help" label={<>{t("cb.margin.sim.leverage")}: <span className="text-orange-300 tabular-nums">{leverage.toFixed(1)}x</span></>}>
              <input type="range" min="1" max="5" step="0.5" value={leverage} onChange={(e) => setLeverage(parseFloat(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.loanRate.help" label={<>{t("cb.margin.sim.loanRate")}: <span className="text-orange-300 tabular-nums">{loanRate.toFixed(1)}%</span></>}>
              <input type="range" min="0" max="15" step="0.5" value={loanRate} onChange={(e) => setLoanRate(parseFloat(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.maintMargin.help" label={<>{t("cb.margin.sim.maintMargin")}: <span className="text-orange-300 tabular-nums">{maintMargin}%</span></>}>
              <input type="range" min="10" max="50" step="1" value={maintMargin} onChange={(e) => setMaintMargin(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.annualReturn.help" label={<>{t("cb.margin.sim.annualReturn")}: <span className={`tabular-nums ${annualReturn >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{annualReturn > 0 ? "+" : ""}{annualReturn}%</span></>}>
              <input type="range" min="-50" max="50" step="1" value={annualReturn} onChange={(e) => setAnnualReturn(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.years.help" label={<>{t("cb.margin.sim.years")}: <span className="text-orange-300 tabular-nums">{years}</span></>}>
              <input type="range" min="1" max="30" step="1" value={years} onChange={(e) => setYears(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.maxDrawdown.help" label={<>{t("cb.margin.sim.maxDrawdown")}: <span className="text-rose-300 tabular-nums">{maxDrawdown}%</span></>}>
              <input type="range" min="1" max="20" step="1" value={maxDrawdown} onChange={(e) => setMaxDrawdown(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.drawdownYear.help" label={<>{t("cb.margin.sim.drawdownYear")}: <span className="text-orange-300 tabular-nums">{drawdownYear}</span></>}>
              <input type="range" min="1" max={years} step="1" value={Math.min(drawdownYear, years)} onChange={(e) => setDrawdownYear(parseInt(e.target.value))} className="w-full accent-orange-500" />
            </SimParam>
            <SimParam helpKey="cb.margin.sim.relevMode.help" label={t("cb.margin.sim.relevMode")}>
              <div className="flex gap-1">
                {RELEV_MODES.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setReleverageMode(m.key)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all ${
                      releverageMode === m.key
                        ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                        : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>
            </SimParam>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
              <div className="text-xs text-slate-500">{t("cb.margin.sim.totalInvested")}</div>
              <div className="mt-0.5 text-lg font-semibold text-slate-100 tabular-nums">{initialTotal.toLocaleString("fr-FR")} €</div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
              <div className="text-xs text-slate-500">{t("cb.margin.sim.loanAmount")}</div>
              <div className="mt-0.5 text-lg font-semibold text-amber-300 tabular-nums">{initialLoan.toLocaleString("fr-FR")} €</div>
            </div>
            <div className="rounded-lg border border-rose-700/40 bg-rose-950/20 p-3">
              <div className="text-xs text-slate-500">{t("cb.margin.sim.liqThreshold")}</div>
              <div className="mt-0.5 text-lg font-semibold text-rose-300 tabular-nums">{liquidationDropPct.toFixed(1)}%</div>
              <div className="text-[10px] text-slate-500">{t("cb.margin.sim.liqAtValue")} {liquidationValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLiquidated ? "border-rose-700/50 bg-rose-950/30" : "border-emerald-700/40 bg-emerald-950/20"}`}>
              <div className="text-xs text-slate-500">{t("cb.margin.sim.status")}</div>
              <div className={`mt-0.5 text-sm font-semibold ${isLiquidated ? "text-rose-300" : "text-emerald-300"}`}>
                {isLiquidated ? t("cb.margin.sim.statusLiquidated") + (liquidationYear ? ` (Y${liquidationYear})` : "") : t("cb.margin.sim.statusSafe")}
              </div>
            </div>
          </div>

          {monthlyProjection.length > 0 && (
            <>
              <div className="mt-5 max-h-72 overflow-y-auto overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-slate-700 bg-slate-900/95">
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.month")}</th>
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.portfolio")}</th>
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.loan")}</th>
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.equity")}</th>
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.interest")}</th>
                      <th className="px-3 py-2 font-semibold text-slate-300">{t("cb.margin.sim.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyProjection.map((r) => (
                      <tr key={r.monthIdx} className={`border-b border-slate-800/60 ${r.status === "liquidated" ? "bg-rose-950/20" : r.status === "warning" ? "bg-amber-950/15" : ""} ${r.drawdownApplied && r.monthIdx === (drawdownYear - 1) * 12 + 1 ? "ring-1 ring-inset ring-rose-500/30" : ""}`}>
                        <td className="px-3 py-1.5 font-medium text-slate-300 tabular-nums whitespace-nowrap">{r.label}{r.drawdownApplied && r.monthIdx === (drawdownYear - 1) * 12 + 1 ? " ↓" : ""}</td>
                        <td className="px-3 py-1.5 text-slate-300 tabular-nums">{r.portfolioValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                        <td className="px-3 py-1.5 text-amber-300/80 tabular-nums">{r.loan.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                        <td className={`px-3 py-1.5 tabular-nums font-medium ${r.equity < 0 ? "text-rose-400" : "text-emerald-300"}`}>{r.equity.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                        <td className="px-3 py-1.5 text-slate-500 tabular-nums">{r.interestPaid.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €</td>
                        <td className="px-3 py-1.5">
                          {r.status === "liquidated" && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-rose-400">{t("cb.margin.sim.statusLiquidated")}</span>}
                          {r.status === "warning" && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-400">{t("cb.margin.sim.statusWarning")}</span>}
                          {r.status === "safe" && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-400">{t("cb.margin.sim.statusSafe")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyProjection} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="monthIdx" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `M${v}`} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(v) => `Mois ${v}`}
                      formatter={(v) => `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine x={(drawdownYear - 1) * 12 + 1} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: "↓", fill: "#f43f5e", fontSize: 12 }} />
                    <Area type="monotone" dataKey="portfolioValue" name={t("cb.margin.sim.col.portfolio")} stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.08} strokeWidth={1.5} />
                    <Line type="monotone" dataKey="loan" name={t("cb.margin.sim.col.loan")} stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="equity" name={t("cb.margin.sim.col.equity")} stroke="#34d399" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="interestPaid" name={t("cb.margin.sim.col.interest")} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <p className="mt-4 text-xs text-slate-500 leading-relaxed">{t("cb.margin.sim.disclaimer")}</p>
        </div>

        <div className="rounded-xl border border-sky-800/40 bg-sky-950/15 p-5">
          <h3 className="mb-3 text-base font-semibold text-sky-300">{t("cb.margin.bestPractices")}</h3>
          <ul className="space-y-2 text-sm text-slate-400">
            {[1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                <span className="leading-relaxed">{t(`cb.margin.tip.${i}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  };

  const BanksTable = ({
    banks,
    scope,
    showCountry,
    showRemote,
    showMulti,
    showSwift,
  }: {
    banks: readonly string[];
    scope: "fr" | "eu" | "world";
    showCountry: boolean;
    showRemote: boolean;
    showMulti: boolean;
    showSwift: boolean;
  }) => (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400/80 leading-relaxed">
        {t(`cb.banks.${scope}.note`)}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/60">
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.banks.col.bank")}</th>
              {showCountry && <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.banks.col.country")}</th>}
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.banks.col.type")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.monthly")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.card")}</th>
              {showRemote && <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.remote")}</th>}
              {showMulti && <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.multiCurrency")}</th>}
              <th className="px-3 py-3 font-semibold text-slate-300 w-px">{t("cb.banks.col.pea")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.fx")}</th>
              {showSwift && <th className="px-3 py-3 font-semibold text-slate-300">{t("cb.banks.col.swift")}</th>}
              <th className="px-3 py-3 font-semibold text-slate-300 min-w-[12rem]">{t("cb.banks.col.pros")}</th>
              <th className="px-3 py-3 font-semibold text-slate-300 min-w-[8rem]">{t("cb.banks.col.bestFor")}</th>
            </tr>
          </thead>
          <tbody>
            {banks.map((b) => {
              const url = b === "fortuneo" && scope === "fr" ? SOURCES.fortuneoBankFr
                : b === "fortuneo" && scope !== "fr" ? SOURCES.fortuneo
                : b === "ibkr" ? SOURCES.ibkrBank
                : SOURCES[b as keyof typeof SOURCES];
              return (
                <tr key={b} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors align-top">
                  <td className="px-3 py-3 font-medium text-slate-100">
                    {t(`cb.banks.${scope}.${b}.name`)}
                    {url && <Src href={url} label={url} />}
                  </td>
                  {showCountry && <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.country`)}</td>}
                  <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.type`)}</td>
                  <td className="px-3 py-3 text-slate-300 tabular-nums">{t(`cb.banks.${scope}.${b}.monthly`)}</td>
                  <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.card`)}</td>
                  {showRemote && <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.remote`)}</td>}
                  {showMulti && <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.multiCurrency`)}</td>}
                  <td className="px-3 py-3 text-slate-300">{t(`cb.banks.${scope}.${b}.pea`)}</td>
                  <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.fx`)}</td>
                  {showSwift && <td className="px-3 py-3 text-slate-400">{t(`cb.banks.${scope}.${b}.swift`)}</td>}
                  <td className="px-3 py-3 text-slate-400 leading-relaxed">{t(`cb.banks.${scope}.${b}.pros`)}</td>
                  <td className="px-3 py-3 text-slate-500 italic leading-relaxed">{t(`cb.banks.${scope}.${b}.bestFor`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const BanksFrTab = () => <BanksTable banks={BANKS_FR} scope="fr" showCountry={false} showRemote={false} showMulti={false} showSwift={false} />;
  const BanksEuTab = () => <BanksTable banks={BANKS_EU} scope="eu" showCountry={true} showRemote={true} showMulti={true} showSwift={false} />;
  const BanksWorldTab = () => <BanksTable banks={BANKS_WORLD} scope="world" showCountry={true} showRemote={true} showMulti={true} showSwift={true} />;

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {TABS.map((tabDef) => {
          const active = tab === tabDef.key;
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-orange-500/15 text-orange-300 border border-orange-500/40"
                  : "bg-slate-900/40 text-slate-400 border border-slate-800 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              {t(tabDef.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "ctoPea" && <CtoPeaTab />}
      {tab === "brokers" && <BrokersTab />}
      {tab === "margin" && <MarginTab />}
      {tab === "banksFr" && <BanksFrTab />}
      {tab === "banksEu" && <BanksEuTab />}
      {tab === "banksWorld" && <BanksWorldTab />}
    </div>
  );
}

export default function ComptesBanques({ mode }: ComptesBanquesProps) {
  return (
    <I18nProvider>
      <ComptesBanquesInner mode={mode} />
    </I18nProvider>
  );
}