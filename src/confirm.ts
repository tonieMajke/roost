/** Two-step delete without `window.confirm`: first click arms, second click fires. */

export const CONFIRM_MS = 3000;

export type Arm = { key: string; at: number } | null;

/**
 * `now` comes from the caller (Date.now) so the rule stays testable.
 * An arm for a different target never fires the new one — it is simply replaced.
 */
export function confirmClick(arm: Arm, key: string, now: number, windowMs = CONFIRM_MS): { fire: boolean; arm: Arm } {
  if (arm && arm.key === key && now - arm.at < windowMs) return { fire: true, arm: null };
  return { fire: false, arm: { key, at: now } };
}

/** Is `arm` currently showing its "Na pewno?" state for `key`? */
export function isArmed(arm: Arm, key: string, now: number, windowMs = CONFIRM_MS): boolean {
  return arm !== null && arm.key === key && now - arm.at < windowMs;
}
