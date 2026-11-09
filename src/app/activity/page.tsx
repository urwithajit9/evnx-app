/**
 * Activity dashboard.
 *
 * ─── Why `/activity/` and not `/` ───────────────────────────────────────────
 *
 * `/` is the public front door: signed-out visitors get "Sign in / Create an
 * account" there, and a reload always lands a signed-in user back in that state
 * (the tokens and master key do not survive one). Turning `/` into the dashboard
 * would mean one route serving two audiences, with the signed-out half still
 * needing the redirect-on-unlock check it has today. And the onboarding
 * checklist lives on `/vaults/` — where sign-in lands, and where `/` sends
 * signed-in users — so leaving `/` alone leaves new users' path unchanged.
 *
 * ─── Where the numbers come from ────────────────────────────────────────────
 *
 * Every card is read off a query other pages already make (`["vaults"]`,
 * `["usage"]`), so opening the dashboard costs one extra request: the activity
 * feed. Nothing here decrypts anything, and no secret value is ever displayed —
 * audit metadata holds ids, roles and version numbers only.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { listActivity, listVaults, type VaultSummary } from "@/lib/api/vaults";
import { getUsage } from "@/lib/api/account";
import { apiErrorStatus } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useKeyStore } from "@/stores/keyStore";
import { useOnboarding } from "@/lib/onboarding";
import { describeEvent, eventActorResolver, AuditEventText } from "@/lib/audit-events";
import { relativeTime } from "@/lib/relative-time";
import { usageLabel } from "@/components/settings/plan-usage";
import { AppShell } from "@/components/shell/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/ui/load-error";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

const PAGE_SIZE = 25;
const ALL = "all";

function vaultHref(id: string) {
  return `/vaults/detail/?id=${encodeURIComponent(id)}`;
}

export default function ActivityPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const unlocked = useKeyStore((s) => s.unlocked);

  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  const verified = user?.emailVerified ?? false;

  const vaults = useQuery({
    queryKey: ["vaults"],
    queryFn: listVaults,
    enabled: unlocked && verified,
  });
  const usage = useQuery({ queryKey: ["usage"], queryFn: getUsage, retry: false });

  const onboarding = useOnboarding({
    userId: user?.userId ?? "",
    emailVerified: verified,
    vaults: vaults.data,
    ready: Boolean(user) && vaults.isSuccess,
  });

  const [filter, setFilter] = useState(ALL);

  const activity = useInfiniteQuery({
    queryKey: ["activity", filter],
    queryFn: ({ pageParam }) =>
      listActivity({
        limit: PAGE_SIZE,
        before: pageParam,
        vaultIds: filter === ALL ? undefined : [filter],
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: unlocked && verified,
  });

  // ⚠️ One unreadable id is a 404 for the whole request, and a vault can vanish
  // (deleted, or access revoked) between the list loading and the pick. Falling
  // back to "all vaults" beats a dead feed. Adjusting state during render, on a
  // condition that stops holding the moment it runs, is React's sanctioned form
  // of this — an effect would paint the error first.
  if (filter !== ALL && apiErrorStatus(activity.error) === 404) {
    setFilter(ALL);
  }

  if (!unlocked || !user) return null;

  const events = activity.data?.pages.flatMap((p) => p.events) ?? [];
  const retentionDays = activity.data?.pages[0]?.retention_days;
  const nameOf = eventActorResolver(events);

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="page-title text-xl font-semibold">Dashboard</h1>

        {!verified && (
          <Alert>
            <AlertTitle>Verify your email to see activity</AlertTitle>
            <AlertDescription>
              Vault routes stay closed until {user.email} is confirmed.{" "}
              <Link href="/verify-email/" className="underline underline-offset-4">
                Resend the email
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        {onboarding.visible && (
          <Alert>
            <AlertTitle>
              Setup: {onboarding.completed} of 5 steps done
            </AlertTitle>
            <AlertDescription>
              <Link href="/vaults/" className="underline underline-offset-4">
                Continue the checklist on your vaults page
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        {verified && (
          <Summary vaults={vaults} usage={usage.data} />
        )}

        {verified && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>Recent activity</CardTitle>
              {vaults.data && vaults.data.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Vault</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-8 max-w-56 rounded-md border bg-background px-2 text-sm text-foreground"
                  >
                    <option value={ALL}>All vaults</option>
                    {vaults.data.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}/{v.environment}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              {activity.isPending && <SkeletonRows count={4} />}

              {activity.isError && (
                <LoadError
                  title="Could not load activity"
                  reassurance="Your vaults and secrets are unaffected — this is the feed failing to load."
                  onRetry={() => activity.refetch()}
                  retrying={activity.isRefetching}
                />
              )}

              {activity.data && events.length === 0 && (
                <EmptyState
                  // ⓘ An empty feed usually means "nothing inside the plan's
                  // history window", not "nothing ever happened": a free plan
                  // keeps 7 days, and the last push may be older than that.
                  title={
                    retentionDays !== undefined
                      ? `No activity in the last ${retentionDays} days`
                      : "No activity yet"
                  }
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link href="/vaults/">Go to your vaults</Link>
                    </Button>
                  }
                >
                  {retentionDays !== undefined &&
                    `Anything older is past your plan's ${retentionDays}-day history. `}
                  Pushes, pulls and sharing changes appear here as they happen.
                </EmptyState>
              )}

              {events.length > 0 && (
                <ul className="divide-y">
                  {events.map((e) => {
                    const { text, tone } = describeEvent(e, nameOf);
                    return (
                      <li key={e.id} className="space-y-0.5 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <Link
                            href={vaultHref(e.vault_id)}
                            className="text-sm font-medium underline-offset-4 hover:underline"
                          >
                            {e.vault_name}
                          </Link>
                          <time
                            className="ml-auto shrink-0 text-xs text-muted-foreground"
                            dateTime={e.created_at}
                            title={new Date(e.created_at).toLocaleString()}
                          >
                            {relativeTime(e.created_at)}
                          </time>
                        </div>
                        <AuditEventText event={e} text={text} tone={tone} />
                      </li>
                    );
                  })}
                </ul>
              )}

              {activity.hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => activity.fetchNextPage()}
                  disabled={activity.isFetchingNextPage}
                >
                  {activity.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              )}

              {activity.isFetchNextPageError && (
                <LoadError
                  title="Could not load more activity"
                  onRetry={() => activity.fetchNextPage()}
                  retrying={activity.isFetchingNextPage}
                />
              )}

              {retentionDays !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Activity is kept for {retentionDays} days on your plan.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-semibold" title={value}>
          {value}
        </p>
        {/* ⓘ Wraps instead of truncating: a vault name like
            "deployworks-web/production" is the useful part of the hint. */}
        {hint && <p className="break-words text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Summary({
  vaults,
  usage,
}: {
  vaults: ReturnType<typeof useQuery<VaultSummary[]>>;
  usage: Awaited<ReturnType<typeof getUsage>> | undefined;
}) {
  if (vaults.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (vaults.isError) {
    return (
      <LoadError
        title="Could not load your vault summary"
        reassurance="Your vaults are unchanged — this is the display failing."
        onRetry={() => vaults.refetch()}
        retrying={vaults.isRefetching}
      />
    );
  }

  const list = vaults.data;
  const owned = list.filter((v) => v.role === "owner").length;
  const versions = list.reduce((n, v) => n + v.version_count, 0);
  // ⚠️ `updated_at` moves on any change to the vault row, not only pushes, so
  // restrict to vaults that have a version — "most recent push" of a vault with
  // none would be a lie.
  const pushed = list
    .filter((v) => v.version_count > 0)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  return (
    <div
      className={
        "grid gap-3 sm:grid-cols-2 " + (usage ? "lg:grid-cols-5" : "lg:grid-cols-4")
      }
    >
      <Stat label="Vaults you own" value={String(owned)} />
      <Stat label="Shared with you" value={String(list.length - owned)} />
      <Stat label="Versions stored" value={String(versions)} hint="Across all vaults you can read" />
      <Stat
        label="Most recent push"
        value={pushed ? relativeTime(pushed.updated_at) : "None yet"}
        hint={pushed ? `${pushed.name}/${pushed.environment}` : undefined}
      />
      {usage && (
        <Stat
          label={`Plan: ${usage.plan}`}
          value={usageLabel(usage.vaults)}
          hint="Vaults you own"
        />
      )}
    </div>
  );
}
