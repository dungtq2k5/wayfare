/**
 * The offer (frame O1, K20): for an area with no pack, never offered before, on Wi-Fi, and not
 * while the language switch's pill shows. The Map is only reached after the first run.
 */
export function shouldOffer(input: {
  packsInArea: number;
  offered: boolean;
  switching: boolean;
  network: string | undefined;
}): boolean {
  return input.packsInArea === 0 && !input.offered && !input.switching && input.network === 'wifi';
}
