/**
 * A query that failed, shown as a failure.
 *
 * ─── ⚠️ Never return `null` on error ────────────────────────────────────────
 *
 * A card that vanishes is indistinguishable from a card that was never
 * designed. `plan-usage.tsx` did exactly this: someone who could not see their
 * quota had no way to tell whether they were on the free plan with nothing used,
 * or whether the request had failed. The scarier reading is the one people
 * reach for.
 *
 * So two rules, and the second is the one that is easy to skip:
 *
 *   • **Keep the card's place.** Same title, same border.
 *   • **Say what is NOT wrong.** "Your limits are unchanged — this is the
 *     display failing, not your plan" is the sentence that stops someone
 *     panicking about a quota they cannot see.
 *
 * ⚠️ **A 401 is not an error state, it is a sign-in**, and a 403 on a vault
 * route means an unverified email rather than a failure. Callers that can
 * receive those must branch before reaching here — `VaultsError` already does,
 * and this component must not tempt anyone into flattening that.
 */

"use client";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function LoadError({
  title,
  reassurance,
  onRetry,
  retrying = false,
}: {
  /** What failed to load, as a noun phrase: "Could not load your usage". */
  title: string;
  /** What is still fine. Omit only when nothing reassuring is true. */
  reassurance?: string;
  /**
   * Re-run the one query. ⚠️ Not a page reload — a reload drops the master key
   * and the tokens, so it would turn a failed fetch into a full sign-in.
   */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      {reassurance && <AlertDescription>{reassurance}</AlertDescription>}
      {onRetry && (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}
    </Alert>
  );
}
