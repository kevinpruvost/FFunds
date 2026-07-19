export type OtherRelationship = "sibling" | "nephew" | "other";
export type SpouseOption = "quarter" | "usufruit";
export type GrandchildrenTransfer = "testament" | "donation";
export type AllocationMode = "equal" | "tax";

export interface SuccessionInput {
  spouse: boolean;
  spouseOption: SpouseOption;
  spouseAge: number;
  allocationMode: AllocationMode;
  children: number;
  grandchildren: number;
  grandchildrenTransfer: GrandchildrenTransfer;
  grandchildrenDonationAmount: number;
  grandchildrenRepresented: boolean;
  otherCount: number;
  otherRelationship: OtherRelationship;
  outsideAssets: number;
  realEstate: number;
  debts: number;
  avBefore70Total: number;
  avAfter70Premiums: number;
  avAfter70Gains: number;
}

export interface TaxRow {
  label: string;
  gross: number;
  allowance: number;
  taxable: number;
  rate: string;
  tax: number;
}

export interface SuccessionResult {
  totalEstate: number;
  estateAtDeath: number;
  lifetimeDonationGross: number;
  standardPool: number;
  totalTax: number;
  net: number;
  effective: string;
  rows: TaxRow[];
  beneficiaries: BeneficiaryResult[];
  transferPlan: TransferStep[];
  warnings: string[];
}

export interface BeneficiaryResult {
  id: string;
  name: string;
  relationship: string;
  gross: number;
  allowance: number;
  taxable: number;
  tax: number;
  donationsOut: number;
  net: number;
}

export interface TransferStep {
  id: string;
  from: string;
  to: string;
  type: "donation";
  gross: number;
  allowance: number;
  taxable: number;
  rate: string;
  tax: number;
  net: number;
}

// CGI article 777: these are widths, not cumulative thresholds.
const DIRECT_BRACKETS: Array<[number, number]> = [
  [8072, 0.05],
  [4037, 0.10],
  [3823, 0.15],
  [536392, 0.20],
  [350514, 0.30],
  [902839, 0.40],
];

/** Progressive direct-line inheritance/donation tax for one beneficiary. */
export function progressiveTax(amount: number): number {
  let remaining = Math.max(0, amount);
  let tax = 0;
  for (const [width, rate] of DIRECT_BRACKETS) {
    const slice = Math.min(remaining, width);
    tax += slice * rate;
    remaining -= slice;
    if (remaining <= 0) return tax;
  }
  return tax + remaining * 0.45;
}

function usufruitRate(age: number): number {
  if (age < 21) return 0.90;
  if (age < 31) return 0.80;
  if (age < 41) return 0.70;
  if (age < 51) return 0.60;
  if (age < 61) return 0.50;
  if (age < 71) return 0.40;
  if (age < 81) return 0.30;
  if (age < 91) return 0.20;
  return 0.10;
}

function taxSingle(amount: number, kind: "direct" | OtherRelationship, allowance: number): number {
  const taxable = Math.max(0, amount - allowance);
  if (kind === "direct") return progressiveTax(taxable);
  if (kind === "sibling") return Math.min(taxable, 24430) * 0.35 + Math.max(0, taxable - 24430) * 0.45;
  if (kind === "nephew") return taxable * 0.55;
  return taxable * 0.60;
}

type BeneficiaryKind = "spouse" | "child" | "grandchild" | OtherRelationship;
type BeneficiarySeed = { id: string; name: string; relationship: string; kind: BeneficiaryKind; allowance: number };

function beneficiaryAllowance(input: SuccessionInput, kind: BeneficiaryKind): number {
  if (kind === "spouse") return Number.POSITIVE_INFINITY;
  if (kind === "child") return 100000;
  if (kind === "grandchild") return input.grandchildrenTransfer === "donation" ? 31865 : input.grandchildrenRepresented ? 100000 : 1594;
  return ({ sibling: 15932, nephew: 7967, other: 1594 } as Record<OtherRelationship, number>)[kind];
}

function beneficiaryTax(amount: number, seed: BeneficiarySeed): number {
  if (seed.kind === "spouse") return 0;
  return taxSingle(amount, seed.kind === "child" || seed.kind === "grandchild" ? "direct" : seed.kind, seed.allowance);
}

function rateLabel(seed: BeneficiarySeed): string {
  if (seed.kind === "spouse") return "0%";
  if (seed.kind === "child" || seed.kind === "grandchild") return "5% — 45%";
  if (seed.kind === "sibling") return "35% / 45%";
  if (seed.kind === "nephew") return "55%";
  return "60%";
}

function buildBeneficiaries(input: SuccessionInput): { spouse: BeneficiarySeed | null; recipients: BeneficiarySeed[] } {
  const spouse = input.spouse ? { id: "spouse", name: "Conjoint / PACS", relationship: "Conjoint / PACS", kind: "spouse" as const, allowance: Number.POSITIVE_INFINITY } : null;
  const recipients: BeneficiarySeed[] = [];
  for (let i = 1; i <= input.children; i += 1) recipients.push({ id: `child-${i}`, name: `Enfant ${i}`, relationship: "Enfant", kind: "child", allowance: 100000 });
  for (let i = 1; i <= input.grandchildren; i += 1) recipients.push({ id: `grandchild-${i}`, name: `Petit-enfant ${i}`, relationship: "Petit-enfant", kind: "grandchild", allowance: beneficiaryAllowance(input, "grandchild") });
  if (recipients.length === 0) {
    for (let i = 1; i <= input.otherCount; i += 1) recipients.push({ id: `other-${i}`, name: `Bénéficiaire ${i}`, relationship: input.otherRelationship, kind: input.otherRelationship, allowance: beneficiaryAllowance(input, input.otherRelationship) });
  }
  return { spouse, recipients };
}

function taxSegments(seed: BeneficiarySeed): Array<[number, number]> {
  if (seed.kind === "spouse") return [[Number.POSITIVE_INFINITY, 0]];
  if (seed.kind === "child" || seed.kind === "grandchild") return [[seed.allowance, 0], ...DIRECT_BRACKETS, [Number.POSITIVE_INFINITY, 0.45]];
  if (seed.kind === "sibling") return [[seed.allowance, 0], [24430, 0.35], [Number.POSITIVE_INFINITY, 0.45]];
  if (seed.kind === "nephew") return [[seed.allowance, 0], [Number.POSITIVE_INFINITY, 0.55]];
  return [[seed.allowance, 0], [Number.POSITIVE_INFINITY, 0.60]];
}

function distributeFairly(amount: number, capacities: Array<{ id: string; capacity: number }>, allocations: Map<string, number>) {
  let remaining = amount;
  const caps = new Map(capacities.map((entry) => [entry.id, entry.capacity]));
  while (remaining > 0.000001) {
    const active = [...caps.entries()].filter(([, capacity]) => capacity > 0.000001);
    if (active.length === 0) return;
    const equalShare = remaining / active.length;
    let moved = 0;
    for (const [id, capacity] of active) {
      const take = Math.min(capacity, equalShare);
      allocations.set(id, (allocations.get(id) || 0) + take);
      caps.set(id, capacity - take);
      remaining -= take;
      moved += take;
    }
    if (moved <= 0.000001) return;
  }
}

/** Minimize tax first, then distribute each equal-rate tranche fairly. */
function allocateTaxOptimally(amount: number, seeds: BeneficiarySeed[]): Map<string, number> {
  const allocations = new Map(seeds.map((seed) => [seed.id, 0]));
  const segments = new Map(seeds.map((seed) => [seed.id, taxSegments(seed)]));
  const positions = new Map(seeds.map((seed) => [seed.id, 0]));
  let remaining = Math.max(0, amount);
  while (remaining > 0.000001) {
    const active = seeds.filter((seed) => (positions.get(seed.id) || 0) < (segments.get(seed.id) || []).length);
    if (active.length === 0) break;
    const minRate = Math.min(...active.map((seed) => (segments.get(seed.id) || [])[positions.get(seed.id) || 0][1]));
    const tranche = active.filter((seed) => (segments.get(seed.id) || [])[positions.get(seed.id) || 0][1] === minRate);
    const capacities = tranche.map((seed) => ({ id: seed.id, capacity: (segments.get(seed.id) || [])[positions.get(seed.id) || 0][0] }));
    const capacityTotal = capacities.reduce((sum, entry) => sum + entry.capacity, 0);
    const take = Math.min(remaining, capacityTotal);
    const before = new Map([...allocations.entries()]);
    distributeFairly(take, capacities, allocations);
    remaining -= take;
    for (const seed of tranche) {
      const consumed = (allocations.get(seed.id) || 0) - (before.get(seed.id) || 0);
      const width = capacities.find((entry) => entry.id === seed.id)?.capacity || 0;
      if (consumed >= width - 0.000001) positions.set(seed.id, (positions.get(seed.id) || 0) + 1);
    }
  }
  return allocations;
}

const GRANDCHILD_DONATION_ALLOWANCE = 31865;
const CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE = 100000;
const AV_WITHDRAWAL_TAX_RATE = 0.30;

function equalAllocation(amount: number, seeds: BeneficiarySeed[]): Map<string, number> {
  const value = Math.max(0, amount) / Math.max(1, seeds.length);
  return new Map(seeds.map((seed) => [seed.id, value]));
}

type RoutedPlan = {
  tax: number;
  routeAmount: number;
  allocations: Map<string, number>;
  gifts: Map<string, { donor: BeneficiarySeed; amount: number }>;
};

/**
 * Compare a direct testament with a child -> grandchild donation chain.
 * The chain is only selected when it is at least as tax-efficient; ties favor
 * routing more money to grandchildren because it gives the user a fuller plan.
 */
function findRoutedTestamentPlan(amount: number, children: BeneficiarySeed[], grandchildren: BeneficiarySeed[], directTax: number): RoutedPlan | null {
  if (amount <= 0 || children.length === 0 || grandchildren.length === 0) return null;
  const childAllocations = allocateTaxOptimally(amount, children);
  const candidates = new Set<number>([0, amount, Math.min(amount, grandchildren.length * CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE)]);
  for (let i = 0; i <= 200; i += 1) candidates.add(amount * i / 200);
  let best: RoutedPlan | null = null;

  for (const routeAmount of candidates) {
    if (routeAmount <= 0.000001) continue;
    const directRemainder = Math.max(0, amount - routeAmount);
    const baseAllocations = allocateTaxOptimally(directRemainder, [...children, ...grandchildren]);
    const allocations = new Map(baseAllocations);
    const routePerChild = routeAmount / children.length;
    children.forEach((child) => allocations.set(child.id, (allocations.get(child.id) || 0) + routePerChild));
    const gifts = new Map<string, { donor: BeneficiarySeed; amount: number }>();
    const giftPerGrandchild = routeAmount / grandchildren.length;
    const donationByChild = new Map<string, number>(children.map((child) => [child.id, 0]));
    grandchildren.forEach((grandchild, index) => {
      const donor = children[index % children.length];
      const amountForGift = giftPerGrandchild;
      gifts.set(grandchild.id, { donor, amount: amountForGift });
      donationByChild.set(donor.id, (donationByChild.get(donor.id) || 0) + amountForGift);
    });
    if (children.some((child) => (donationByChild.get(child.id) || 0) > (allocations.get(child.id) || 0) + 0.000001)) continue;

    const childTax = children.reduce((sum, child) => sum + beneficiaryTax(allocations.get(child.id) || 0, child), 0);
    const directGrandchildTax = grandchildren.reduce((sum, grandchild) => sum + beneficiaryTax(allocations.get(grandchild.id) || 0, grandchild), 0);
    const donationTax = grandchildren.reduce((sum, grandchild) => {
      const gift = gifts.get(grandchild.id)?.amount || 0;
      return sum + taxSingle(gift, "direct", CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE);
    }, 0);
    const tax = childTax + directGrandchildTax + donationTax;
    if (!best || tax < best.tax - 0.000001 || (Math.abs(tax - best.tax) <= 0.000001 && routeAmount > best.routeAmount)) {
      best = { tax, routeAmount, allocations, gifts };
    }
  }
  return best && best.tax <= directTax + 0.000001 ? best : null;
}

export function calculateSuccession(input: SuccessionInput): SuccessionResult {
  const rows: TaxRow[] = [];
  const warnings: string[] = [];
  const transferPlan: TransferStep[] = [];
  const outgoingDonations = new Map<string, number>();
  const nonAv = Math.max(0, input.outsideAssets + input.realEstate - input.debts);
  const originalAvGross = Math.max(0, input.avAfter70Premiums + input.avAfter70Gains);
  const originalTotalEstate = nonAv + input.avBefore70Total + input.avAfter70Premiums + input.avAfter70Gains;
  const built = buildBeneficiaries(input);
  const allSeeds = built.spouse ? [built.spouse, ...built.recipients] : built.recipients;
  const donationMode = input.grandchildrenTransfer === "donation" && input.grandchildren > 0;

  let lifetimeDonationGross = 0;
  let donationTax = 0;
  let avWithdrawalTax = 0;
  let remainingNonAv = nonAv;
  let remainingAvPremiums = input.avAfter70Premiums;
  let remainingAvGains = input.avAfter70Gains;

  if (donationMode) {
    const requestedDonation = Number.isFinite(input.grandchildrenDonationAmount) ? input.grandchildrenDonationAmount : input.grandchildren * GRANDCHILD_DONATION_ALLOWANCE;
    lifetimeDonationGross = Math.min(Math.max(0, requestedDonation), originalTotalEstate);
    const fromAv = Math.min(lifetimeDonationGross, originalAvGross);
    const gainShare = originalAvGross > 0 ? fromAv * input.avAfter70Gains / originalAvGross : 0;
    const premiumShare = fromAv - gainShare;
    const fromNonAv = Math.max(0, lifetimeDonationGross - fromAv);
    remainingNonAv = Math.max(0, nonAv - fromNonAv);
    remainingAvPremiums = Math.max(0, input.avAfter70Premiums - premiumShare);
    remainingAvGains = Math.max(0, input.avAfter70Gains - gainShare);
    avWithdrawalTax = gainShare * AV_WITHDRAWAL_TAX_RATE;

    const giftPerGrandchild = lifetimeDonationGross / Math.max(1, input.grandchildren);
    for (let index = 0; index < input.grandchildren; index += 1) {
      const grandchild = built.recipients.find((seed) => seed.id === `grandchild-${index + 1}`);
      if (!grandchild || giftPerGrandchild <= 0) continue;
      const tax = taxSingle(giftPerGrandchild, "direct", GRANDCHILD_DONATION_ALLOWANCE);
      donationTax += tax;
      transferPlan.push({
        id: `lifetime-donation-${grandchild.id}`,
        from: "Donateur — retrait AV / liquidités",
        to: grandchild.name,
        type: "donation",
        gross: giftPerGrandchild,
        allowance: Math.min(giftPerGrandchild, GRANDCHILD_DONATION_ALLOWANCE),
        taxable: Math.max(0, giftPerGrandchild - GRANDCHILD_DONATION_ALLOWANCE),
        rate: "5% — 45%",
        tax,
        net: giftPerGrandchild - tax,
      });
    }
    if (avWithdrawalTax > 0) rows.push({ label: "Retrait AV pour donation — fiscalité des gains", gross: gainShare, allowance: 0, taxable: gainShare, rate: "PFU 30% (hyp.)", tax: avWithdrawalTax });
    if (lifetimeDonationGross > 0) warnings.push("La donation est supposée financée par un retrait d'AV en priorité; la part de gains retirée est taxée à 30% par hypothèse (12,8% + prélèvements sociaux). Le taux réel dépend de l'ancienneté, des versements et de l'option fiscale du contrat.");
    if (fromNonAv > 0) warnings.push("Le montant de donation qui dépasse l'AV disponible est prélevé sur les liquidités / actifs hors AV.");
  }

  const after70Allowance = Math.min(remainingAvPremiums, 30500);
  const after70TaxablePremiums = Math.max(0, remainingAvPremiums - after70Allowance);
  const standardPool = remainingNonAv + after70TaxablePremiums;
  const estateAtDeath = remainingNonAv + input.avBefore70Total + remainingAvPremiums + remainingAvGains;
  const standardShares = new Map<string, number>();
  if (built.spouse) standardShares.set(built.spouse.id, 0);

  let recipientPool = standardPool;
  if (built.spouse && built.recipients.length > 0) {
    const spouseShare = input.spouseOption === "quarter" ? standardPool * 0.25 : standardPool * usufruitRate(Math.max(0, input.spouseAge));
    standardShares.set(built.spouse.id, spouseShare);
    recipientPool -= spouseShare;
    if (input.spouseOption === "usufruit") warnings.push("L'usufruit est valorisé selon l'âge saisi et suppose que tous les descendants sont communs.");
  } else if (built.spouse && built.recipients.length === 0) {
    standardShares.set(built.spouse.id, standardPool);
    recipientPool = 0;
    warnings.push("Le conjoint est supposé être le seul héritier; parents survivants, testament ou donation au dernier vivant peuvent modifier la part civile.");
  }

  const directAllocations = input.allocationMode === "tax" ? allocateTaxOptimally(recipientPool, built.recipients) : equalAllocation(recipientPool, built.recipients);
  let allocations = directAllocations;
  const directTax = built.recipients.reduce((sum, seed) => sum + beneficiaryTax(directAllocations.get(seed.id) || 0, seed), 0);
  if (input.allocationMode === "tax" && input.grandchildrenTransfer === "testament") {
    const routed = findRoutedTestamentPlan(recipientPool, built.recipients.filter((seed) => seed.kind === "child"), built.recipients.filter((seed) => seed.kind === "grandchild"), directTax);
    if (routed) {
      allocations = routed.allocations;
      routed.gifts.forEach((gift, grandchildId) => {
        const grandchild = built.recipients.find((seed) => seed.id === grandchildId);
        if (!grandchild) return;
        const tax = taxSingle(gift.amount, "direct", CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE);
        outgoingDonations.set(gift.donor.id, (outgoingDonations.get(gift.donor.id) || 0) + gift.amount);
        transferPlan.push({ id: `testament-route-${gift.donor.id}-${grandchild.id}`, from: `${gift.donor.name} — héritage`, to: grandchild.name, type: "donation", gross: gift.amount, allowance: Math.min(gift.amount, CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE), taxable: Math.max(0, gift.amount - CHILD_TO_GRANDCHILD_DONATION_ALLOWANCE), rate: "5% — 45%", tax, net: gift.amount - tax });
      });
      warnings.push("Parcours optimisé retenu : les enfants héritent d'abord par testament, puis reversent une part à leurs propres enfants par donation (abattement parent-enfant de 100 000 € par couple donateur/donataire, sous réserve des donations antérieures). Le rapport détaille chaque étape et chaque abattement.");
    }
  }
  allocations.forEach((amount, id) => standardShares.set(id, amount));
  if (input.allocationMode === "tax") warnings.push("Optimisation fiscale appliquée à l'assiette successorale; elle ne remplace pas la réserve héréditaire ni les clauses civiles.");
  if (input.children > 0 && input.grandchildren > 0) warnings.push("Enfants et petits-enfants sont explicitement désignés; vérifiez la réserve héréditaire.");
  if (input.grandchildrenRepresented) warnings.push("La représentation est supposée à raison d'un petit-enfant par souche; une représentation multiple partage l'abattement de 100 000 € de la souche.");

  const beneficiaries: BeneficiaryResult[] = allSeeds.map((seed) => {
    const gross = standardShares.get(seed.id) || 0;
    const allowance = seed.kind === "spouse" ? gross : Math.min(gross, seed.allowance);
    const taxable = Math.max(0, gross - allowance);
    const tax = beneficiaryTax(gross, seed);
    const donationsOut = outgoingDonations.get(seed.id) || 0;
    return { id: seed.id, name: seed.name, relationship: seed.relationship, gross, allowance, taxable, tax, donationsOut, net: gross - tax - donationsOut };
  });
  beneficiaries.forEach((person) => rows.push({ label: person.name, gross: person.gross, allowance: person.allowance, taxable: person.taxable, rate: rateLabel(allSeeds.find((seed) => seed.id === person.id)!), tax: person.tax }));
  transferPlan.forEach((step) => rows.push({ label: `${step.from} → ${step.to}`, gross: step.gross, allowance: step.allowance, taxable: step.taxable, rate: step.rate, tax: step.tax }));

  if (input.avBefore70Total > 0) {
    const nonSpouse = allSeeds.filter((seed) => seed.kind !== "spouse");
    const share = input.avBefore70Total / Math.max(1, nonSpouse.length + (built.spouse ? 1 : 0));
    const taxablePerPerson = Math.max(0, share - 152500);
    const taxPerPerson = Math.min(taxablePerPerson, 700000) * 0.20 + Math.max(0, taxablePerPerson - 700000) * 0.3125;
    rows.unshift({ label: "Assurance-vie — versements avant 70 ans", gross: input.avBefore70Total, allowance: Math.min(share, 152500) * nonSpouse.length, taxable: taxablePerPerson * nonSpouse.length, rate: taxablePerPerson > 700000 ? "20% / 31,25%" : taxablePerPerson > 0 ? "20%" : "—", tax: taxPerPerson * nonSpouse.length });
  }
  if (after70Allowance > 0) rows.unshift({ label: "Assurance-vie — abattement global après 70 ans", gross: after70Allowance, allowance: after70Allowance, taxable: 0, rate: "0%", tax: 0 });
  if (remainingAvGains > 0) rows.unshift({ label: "Assurance-vie — gains après 70 ans (hors assiette)", gross: remainingAvGains, allowance: remainingAvGains, taxable: 0, rate: "0%", tax: 0 });

  const totalTax = rows.reduce((sum, row) => sum + row.tax, 0);
  const totalEstate = estateAtDeath + lifetimeDonationGross;
  const net = totalEstate - totalTax;
  return { totalEstate, estateAtDeath, lifetimeDonationGross, standardPool, totalTax, net, effective: totalEstate > 0 ? `${(totalTax / totalEstate * 100).toFixed(1)}%` : "—", rows, beneficiaries, transferPlan, warnings };
}
