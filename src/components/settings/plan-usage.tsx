/**
 * Plan and usage.
 *
 * ─── Why this card exists ───────────────────────────────────────────────────
 *
 * Every limit in evnx used to be discoverable exactly one way: by being refused.
 * The refusals are good — they name the limit and the remedy — but a limit you
 * learn about at the moment it blocks you is one nobody could plan around. The
 * version cap is the sharp one: it blocks a `push`, which people run under time
 * pressure.
 *
 * ─── ⚠️ `used === limit` is full, not nearly full ───────────────────────────
 *
 * The server refuses at `count >= limit`, so three of three means the next
 * create is *already* rejected. A neutral "3 / 3" would read as one remaining to
 * anyone used to progress bars, so full is coloured and labelled.
 *
 * ─── Why versions are listed per vault ──────────────────────────────────────
 *
 * The cap applies per vault, so a single total would be a number corresponding
 * to no limit anyone can hit. Only vaults you **own** appear: a vault shared to
 * you spends its owner's allowance, not yours.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { getUsage, type UsageCount } from "@/lib/api/account";
import { apiErrorStatus } from "@/lib/api/client";
import { SkeletonLines } from "@/components/ui/skeleton";
import { LoadError } from "@/components/ui/load-error";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** `used / limit`, or "unlimited". Exported for the vaults-page summary. */
export function usageLabel({ used, limit }: UsageCount): string {
  if (limit === null) return `${used} (unlimited)`;
  return `${used} / ${limit}`;
}

/** At or over the limit the next one is already refused. */
export function isFull({ used, limit }: UsageCount): boolean {
  return limit !== null && used >= limit;
}

/** One slot left — the last moment a warning is still actionable. */
export function isNearlyFull({ used, limit }: UsageCount): boolean {
  return limit !== null && used < limit && used + 1 >= limit;
}

function Row({ label, count }: { label: string; count: UsageCount }) {
  const full = isFull(count);
  const near = isNearlyFull(count);
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm">{label}</span>
      <span
        className={
          full
            ? "font-mono text-sm font-medium text-destructive"
            : near
              ? "font-mono text-sm font-medium text-amber-600 dark:text-amber-500"
              : "font-mono text-sm text-muted-foreground"
        }
      >
        {usageLabel(count)}
        {full && " — full"}
      </span>
    </div>
  );
}

export function PlanUsage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: getUsage });

  // ⚠️ **A 404 is the only failure worth being silent about**, and the two cases
  // are genuinely different:
  //
  //   • 404 — the server predates `/auth/usage`. Nothing is wrong, the route is
  //     simply not there, and a red box would be describing our own rollout.
  //   • anything else — the request failed. Returning `null` here is what made
  //     a missing quota indistinguishable from a quota of zero, and the scarier
  //     reading is the one people reach for.
  //
  // The old code took the first branch for both.
  const absent = apiErrorStatus(usage.error) === 404;
  if (usage.isError && absent) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan and usage</CardTitle>
        <CardDescription>
          {usage.data
            ? `You are on the ${usage.data.plan} plan.`
            : "What your plan allows, and how much of it you are using."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {usage.isPending && <SkeletonLines count={3} />}

        {usage.isError && !absent && (
          <LoadError
            title="Could not load your usage"
            reassurance="Your limits are unchanged — this is the display failing, not your plan."
            onRetry={() => usage.refetch()}
            retrying={usage.isRefetching}
          />
        )}

        {usage.data && (
          <>
            <div className="divide-y">
              <Row label="Vaults you own" count={usage.data.vaults} />
              <Row label="Active API tokens" count={usage.data.api_tokens} />
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">
                Versions per vault
                {usage.data.versions_per_vault.limit !== null &&
                  ` — ${usage.data.versions_per_vault.limit} each`}
              </p>
              {usage.data.versions_per_vault.limit === null ? (
                <p className="text-sm text-muted-foreground">Unlimited.</p>
              ) : usage.data.versions_per_vault.vaults.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You do not own any vaults yet.
                </p>
              ) : (
                <div className="divide-y">
                  {usage.data.versions_per_vault.vaults.map((v) => (
                    <Row
                      key={v.id}
                      label={`${v.name}/${v.environment}`}
                      count={{
                        used: v.used,
                        limit: usage.data!.versions_per_vault.limit,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {usage.data.versions_per_vault.vaults.some((v) =>
              isFull({ used: v.used, limit: usage.data!.versions_per_vault.limit }),
            ) && (
              <Alert variant="destructive">
                <AlertTitle>A vault is at its version limit</AlertTitle>
                <AlertDescription>
                  The next push to it will be refused. Remove an older version to
                  make room — <code className="font-mono">evnx cloud history</code>{" "}
                  lists them and{" "}
                  <code className="font-mono">evnx cloud delete-version</code>{" "}
                  removes one. The latest cannot be deleted.
                </AlertDescription>
              </Alert>
            )}

            {usage.data.audit_retention_days !== null && (
              <p className="text-xs text-muted-foreground">
                Activity history is shown for the last{" "}
                {usage.data.audit_retention_days} days. ⚠️ That is how far back
                the view reaches — nothing is deleted.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
