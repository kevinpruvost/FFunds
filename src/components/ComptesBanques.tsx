import { useState } from "react";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";

type Mode = "comptes" | "banques";
type TabKey = "ctoPea" | "brokers" | "banksFr" | "banksEu" | "banksWorld";

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
  ];
  const BANQUES_TABS: { key: TabKey; labelKey: string }[] = [
    { key: "banksFr", labelKey: "cb.tab.banks.fr" },
    { key: "banksEu", labelKey: "cb.tab.banks.eu" },
    { key: "banksWorld", labelKey: "cb.tab.banks.world" },
  ];
  const TABS = mode === "comptes" ? COMPTES_TABS : BANQUES_TABS;
  const [tab, setTab] = useState<TabKey>(TABS[0].key);

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

  // ── Banks tabs ──
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