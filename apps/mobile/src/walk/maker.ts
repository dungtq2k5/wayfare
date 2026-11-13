/** Phones whose HyperOS/MIUI stops background apps unless told otherwise (handoff W18). */
const XIAOMI = ['xiaomi', 'redmi', 'poco'];

/** Whether the phone's maker puts the HyperOS section first. */
export function isXiaomi(manufacturer: string | null | undefined): boolean {
  return manufacturer != null && XIAOMI.includes(manufacturer.trim().toLowerCase());
}
