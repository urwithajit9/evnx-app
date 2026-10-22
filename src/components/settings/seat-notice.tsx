/**
 * "Your organisation is on a paid plan, and you hold no seat in it."
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * The server resolves an account's plan as **the plan of the organisation it
 * holds a seat in, else the account's own** (`quota::resolve_plan`). Paying for
 * seats does not hand one out — an organisation's owner is created holding
 * none — so the person who just paid sees `free`, `1 / 3`, which reads exactly
 * like the payment having failed. `/billing/` explained it, but only when
 * *nobody* in the organisation held a seat, and only to whoever opened that
 * page. Everywhere the plan is shown said "free" and nothing else.
 *
 * ⚠️ Derived from `GET /orgs`, which the Organizations and Billing pages already
 * make and cache under the same key — no new endpoint. If it fails, the notice
 * is simply absent: it explains a plan, it is not the plan.
 *
 * ⚠️ Shown only when an organisation's plan is ABOVE the one that applies to
 * you. Holding no seat in a free organisation, or in one on the plan you
 * already have, changes nothing, and saying so would be noise.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listOrgs, setSeat, type OrgSummary } from "@/lib/api/orgs";
import type { Usage } from "@/lib/api/account";
import { apiErrorMessage } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Higher is more. A plan this does not know ranks below everything. */
const PLAN_RANK: Record<string, number> = { free: 0, team: 1, enterprise: 2 };

/** Organisations on a higher plan than `plan`, where you hold no seat. */
export function unseatedPaidOrgs(orgs: OrgSummary[], plan: string): OrgSummary[] {
  const mine = PLAN_RANK[plan];
  if (mine === undefined) return [];
  return orgs.filter(
    (o) => !o.you_hold_a_seat && (PLAN_RANK[o.plan] ?? -1) > mine,
  );
}

export function SeatNotice({ usage }: { usage: Usage }) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: listOrgs, retry: false });
  const [error, setError] = useState<string | null>(null);

  // ⚠️ A seat IS a plan change, and this is the person it happens to, acting
  // on themselves — the same request as "Assign seat" on the Organizations
  // page. The server decides whether it is allowed: it refuses a member, a
  // full organisation, and a person already seated elsewhere, each with a
  // sentence that is shown as sent.
  const take = useMutation({
    mutationFn: async (orgId: string) => {
      if (!user) throw new Error("Sign in again to take a seat.");
      await setSeat(orgId, user.userId, true);
    },
    onSuccess: async (_done, orgId) => {
      setError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["usage"] }),
        qc.invalidateQueries({ queryKey: ["orgs"] }),
        qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
        qc.invalidateQueries({ queryKey: ["billing", orgId] }),
      ]);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  if (!orgs.data) return null;
  const unseated = unseatedPaidOrgs(orgs.data, usage.plan);
  if (unseated.length === 0) return null;

  // At most one: the database makes a second seat unstorable.
  const seatedIn = orgs.data.find((o) => o.you_hold_a_seat);

  return (
    <div className="space-y-3">
      {unseated.map((org) => (
        <Alert key={org.id}>
          <AlertTitle>
            {org.name} is on the {org.plan} plan, but you hold no seat there
          </AlertTitle>
          <AlertDescription>
            <p>
              So{" "}
              {usage.plan_via
                ? `${usage.plan_via.name}'s ${usage.plan} plan`
                : `your own ${usage.plan} plan`}{" "}
              applies to you. Paying for seats does not hand one out — a seat
              is what connects an organisation&apos;s plan to a person.
            </p>
            <SeatAction
              org={org}
              seatedIn={seatedIn}
              busy={take.isPending && take.variables === org.id}
              onTake={() => take.mutate(org.id)}
            />
          </AlertDescription>
        </Alert>
      ))}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function SeatAction({
  org,
  seatedIn,
  busy,
  onTake,
}: {
  org: OrgSummary;
  seatedIn: OrgSummary | undefined;
  busy: boolean;
  onTake: () => void;
}) {
  // Only an owner or an admin can assign. Telling a member to press a button
  // the server refuses them is worse than telling them who to ask.
  const canAssign = org.your_role === "owner" || org.your_role === "admin";

  // ⚠️ Checked before offering the button, because the button would only be
  // refused: one seat per person, and this person's is somewhere else.
  if (seatedIn) {
    return (
      <p>
        Your seat is in {seatedIn.name}, on the {seatedIn.plan} plan. A person
        can hold one seat at a time, so it has to be released in{" "}
        <Link href="/organizations/" className="underline underline-offset-4">
          Organizations
        </Link>{" "}
        first
        {canAssign
          ? "."
          : `, and then an owner or an admin of ${org.name} assigns you one.`}
      </p>
    );
  }

  if (!canAssign) {
    return <p>Ask an owner or an admin of {org.name} to assign you one.</p>;
  }

  const { used, purchased } = org.seats;
  if (purchased !== null && used >= purchased) {
    return (
      <p>
        {purchased === 1
          ? "The only seat is assigned."
          : `All ${purchased} seats are assigned.`}{" "}
        Release one in{" "}
        <Link href="/organizations/" className="underline underline-offset-4">
          Organizations
        </Link>
        , or raise the seat count in{" "}
        <Link href="/billing/" className="underline underline-offset-4">
          Billing
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={onTake} disabled={busy}>
        {busy ? "Taking a seat…" : `Take a seat in ${org.name}`}
      </Button>
      <span className="text-xs text-muted-foreground">
        Your limits become the {org.plan} plan&apos;s. It gives no access to
        any vault.
      </span>
    </div>
  );
}
