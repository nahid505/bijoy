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
