/**
 * How long a story has actually sounded (rdm-spec A-4's listening): paused time and the time before
 * the first sound left out. Fed the player's sounding/silent changes, in milliseconds.
 */
export class ListenClock {
  private total = 0;
  private since: number | null = null;
  private sounded = false;

  /** Sound started (or resumed) at `at`. True the first time: the story's `NARRATION_STARTED`. */
  sounding(at: number): boolean {
    const first = !this.sounded;
    this.sounded = true;
    this.since ??= at;
    return first;
  }

  /** Sound stopped (paused, buffering, ended) at `at`. */
  silent(at: number): void {
    if (this.since !== null) this.total += Math.max(0, at - this.since);
    this.since = null;
  }

  /** Whether any sound played. */
  get hasSounded(): boolean {
    return this.sounded;
  }

  /** The sounded time up to `at`. */
  listened(at: number): number {
    return this.total + (this.since === null ? 0 : Math.max(0, at - this.since));
  }
}
