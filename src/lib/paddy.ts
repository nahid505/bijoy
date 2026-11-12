// Paddy purchase (rice mill weighbridge slip) — pure calculations shared by the form (live preview)
// and the server (what is saved). 1 মণ = 40 kg.
//
//   bag_count    information for the slip only — never used in any calculation
//   gross_scale  = loaded vehicle − empty vehicle (weighbridge), or typed directly
//   net_scale  = gross_scale − dhalta            (dhalta: manual deduction in kg)
//   mon        = net_scale ÷ 40, 2 decimals
//   total      = mon × rate_per_mon, 2 decimals
import { round2, round3 } from "./calc";

export const KG_PER_MON = 40;

export interface PaddyWeights {
  grossKg: number;
  dhaltaKg: number;
  ratePerMon: number;
}

export interface PaddyFigures {
  netKg: number;
  mon: number;
  totalPrice: number;
}

/** Weighbridge: the paddy's gross weight = loaded vehicle − empty vehicle (null until both are given and valid). */
export function weighbridgeGross(vehicleGrossKg: number | null | undefined, vehicleTareKg: number | null | undefined): number | null {
  const g = Number(vehicleGrossKg) || 0;
  const t = Number(vehicleTareKg) || 0;
  return g > 0 && t > 0 && g > t ? round3(g - t) : null;
}

/** Common paddy varieties for the slip's suggestion list (any other name can be typed). */
export const PADDY_VARIETIES = ["মিনিকেট", "নাজিরশাইল", "ব্রি-২৮", "ব্রি-২৯", "ব্রি-৪৯", "স্বর্ণা", "কাটারিভোগ", "চিনিগুঁড়া", "আমন", "বোরো", "হাইব্রিড"];

export function paddyFigures(w: PaddyWeights): PaddyFigures {
  const netKg = round3(Math.max(0, (Number(w.grossKg) || 0) - (Number(w.dhaltaKg) || 0)));
  const mon = round2(netKg / KG_PER_MON);
  const totalPrice = round2(mon * (Number(w.ratePerMon) || 0));
  return { netKg, mon, totalPrice };
}

/** Weights as mon + kg for the slip, e.g. 1 037 kg → "২৫ মণ ৩৭ কেজি". */
export function monAndKg(kg: number): { mon: number; kg: number } {
  const whole = Math.floor(round3(kg) / KG_PER_MON);
  return { mon: whole, kg: round3(kg - whole * KG_PER_MON) };
}

export interface PaddyLineCalcInput {
  bagCount?: number;
  juteBagQty?: number;
  plasticBagQty?: number;
  totalBags?: number;
  vehicleGrossKg?: number | null;
  vehicleTareKg?: number | null;
  grossKg: number;
  dhaltaKg: number;
  ratePerMon: number;
}

export interface PaddyLineComputed extends PaddyFigures {
  grossKg: number;
  dhaltaKg: number;
  ratePerMon: number;
  juteBagQty: number;
  plasticBagQty: number;
  totalBags: number;
  bagCount: number;
}

/** Computes net kg, mon, price, and bag breakdown for a single paddy entry. */
export function computePaddyLine(line: PaddyLineCalcInput): PaddyLineComputed {
  const grossKg = weighbridgeGross(line.vehicleGrossKg, line.vehicleTareKg) ?? (Number(line.grossKg) || 0);
  const dhaltaKg = Number(line.dhaltaKg) || 0;
  const ratePerMon = Number(line.ratePerMon) || 0;
  const figs = paddyFigures({ grossKg, dhaltaKg, ratePerMon });
  const juteBagQty = Math.max(0, Math.trunc(Number(line.juteBagQty) || 0));
  const plasticBagQty = Math.max(0, Math.trunc(Number(line.plasticBagQty) || 0));
  const sumBags = juteBagQty + plasticBagQty;
  const totalBags = sumBags > 0 ? sumBags : Math.max(0, Math.trunc(Number(line.totalBags || line.bagCount) || 0));
  return { ...figs, grossKg, dhaltaKg, ratePerMon, juteBagQty, plasticBagQty, totalBags, bagCount: totalBags };
}

/** Aggregates bag counts, weights, mon, weighted rate, and total price across paddy cart lines. */
export function summarizePaddyLines(lines: PaddyLineCalcInput[]) {
  const computed = lines.map(computePaddyLine);
  const juteBagQty = computed.reduce((s, l) => s + l.juteBagQty, 0);
  const plasticBagQty = computed.reduce((s, l) => s + l.plasticBagQty, 0);
  const totalBags = computed.reduce((s, l) => s + l.totalBags, 0);
  const grossKg = round3(computed.reduce((s, l) => s + l.grossKg, 0));
  const dhaltaKg = round3(computed.reduce((s, l) => s + l.dhaltaKg, 0));
  const netKg = round3(computed.reduce((s, l) => s + l.netKg, 0));
  const mon = round2(computed.reduce((s, l) => s + l.mon, 0));
  const totalPrice = round2(computed.reduce((s, l) => s + l.totalPrice, 0));
  const ratePerMon = computed.length === 1 ? computed[0].ratePerMon : mon > 0 ? round2(totalPrice / mon) : 0;
  return {
    items: computed,
    bagCount: totalBags,
    juteBagQty,
    plasticBagQty,
    totalBags,
    grossKg,
    dhaltaKg,
    netKg,
    mon,
    ratePerMon,
    totalPrice,
  };
}
