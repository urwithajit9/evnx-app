/**
 * Billing.
 *
 * ⚠️ A top-level route, not a tab under `/organizations`, because
 * `evnx.dev/pricing` links straight here: `checkoutUrl()` in
 * `@evnx/config` resolves to `app.evnx.dev/billing/?plan=team`. Someone
 * arriving from the marketing site lands on the plan they clicked.
 *
 * ⛔ Nothing on this screen touches a vault. See `components/billing/billing.tsx`.
 */

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/shell/app-shell";
import { Billing } from "@/components/billing/billing";

/** The plans the server will accept. Anything else in `?plan=` is ignored. */
const KNOWN_PLANS = ["team", "enterprise"];

export default function BillingPage() {
  const router = useRouter();
  const unlocked = useKeyStore((s) => s.unlocked);
  const user = useAuthStore((s) => s.user);

  // ⚠️ Not `useSearchParams`: under `output: "export"` that requires a Suspense
  // boundary around the whole page, and this only preselects a card.
  //
  // ⚠️ Validated against a closed set rather than passed through. It reaches a
  // comparison and nothing more today, but an unchecked query parameter that
  // steers a payment screen is the kind of thing that grows a use later.
  const plan = useSyncExternalStore(
    () => () => {},
    () => {
      const raw = new URLSearchParams(window.location.search).get("plan");
      return raw && KNOWN_PLANS.includes(raw) ? raw : undefined;
    },
    () => undefined,
  );

  useEffect(() => {
    // ⚠️ Carries `next`, so arriving from evnx.dev while signed out returns
    // here after signing in rather than dropping the person on /vaults with no
    // idea what happened to the plan they clicked.
    if (!unlocked) router.replace("/login/?next=/billing/");
  }, [unlocked, router]);

  if (!unlocked || !user) return null;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="page-title text-xl font-semibold">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A plan is bought by an organisation and applies to whoever holds its
            seats. It does not give anyone access to a vault.
          </p>
        </div>

        <Billing preselectPlan={plan} />
      </div>
    </AppShell>
  );
}
