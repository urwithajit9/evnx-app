/**
 * Who can open which vault — a read-only grid.
 *
 * Rows are people, columns are vaults, a cell is that person's role. It is
 * assembled from the same `GET /vaults/:id/members` the Members card uses, one
 * call per vault, so there is no endpoint behind it that could disagree with
 * the cards.
 *
 * ⛔ Read-only on purpose, and not a stepping stone to "grant this person
 * everything". Access to a vault means holding a copy of its key wrapped to
 * their public keys, and only someone who can already open the vault can make
 * that wrap — the server cannot. An org-wide grant would need the server to do
 * it, which is exactly what it must never be able to do. Changing access stays
 * in each vault's Members card.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  listMembers,
  listVaults,
  type VaultMember,
  type VaultSummary,
} from "@/lib/api/vaults";
import { apiErrorStatus } from "@/lib/api/client";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/shell/app-shell";
import { LoadError } from "@/components/ui/load-error";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** How many member lists are in flight at once. */
const CONCURRENCY = 4;

/**
 * Run `task` when fewer than `CONCURRENCY` others are running.
 *
 * ⚠️ `useQueries` fires every query at once, so twenty vaults would be twenty
 * simultaneous requests. A module-level queue keeps the cap across re-renders;
 * react-query still owns caching, retries and state.
 */
let running = 0;
const waiting: Array<() => void> = [];
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) {
    // The slot is handed over by whoever finishes, still counted in `running`,
    // so a newcomer cannot slip in between the release and the wake-up.
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** 403 and 404 mean "not yours to list", not "broken" — see the skipped note. */
function isNoRights(error: unknown): boolean {
  const status = apiErrorStatus(error);
  return status === 403 || status === 404;
}

export default function AccessOverviewPage() {
  const router = useRouter();
  const unlocked = useKeyStore((s) => s.unlocked);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  const vaults = useQuery({
    queryKey: ["vaults"],
    queryFn: listVaults,
    enabled: unlocked,
  });

  // Same key as the Members card, so a vault you just visited is a cache hit.
  const memberQueries = useQueries({
    queries: (vaults.data ?? []).map((v) => ({
      queryKey: ["members", v.id],
      queryFn: () => limited(() => listMembers(v.id)),
      // A refusal will not change on a retry; a dropped connection might.
      retry: (count: number, e: unknown) => !isNoRights(e) && count < 2,
    })),
  });

  if (!unlocked || !user) return null;

  const sorted = [...(vaults.data ?? [])].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.environment.localeCompare(b.environment),
  );
  // `useQueries` keeps the order it was given, which was the unsorted one.
  const byId = new Map(
    (vaults.data ?? []).map((v, i) => [v.id, memberQueries[i]] as const),
  );

  const columns: Array<{ vault: VaultSummary; members: VaultMember[] }> = [];
  let skipped = 0;
  let failed = 0;
  let pending = false;
  for (const vault of sorted) {
    const q = byId.get(vault.id);
    if (!q || q.isPending) pending = true;
    else if (q.isError) {
      if (isNoRights(q.error)) skipped += 1;
      else failed += 1;
    } else if (q.data) columns.push({ vault, members: q.data });
  }

  // One row per person, you first. Keyed on user id: two vaults can show the
  // same address and the id is what ties them to one person.
  const people = new Map<string, { email: string; isYou: boolean }>();
  for (const { members } of columns) {
    for (const m of members) {
      if (!people.has(m.user_id)) {
        people.set(m.user_id, { email: m.email, isYou: m.is_you });
      }
    }
  }
  const rows = [...people.entries()].sort(
    ([, a], [, b]) =>
      Number(b.isYou) - Number(a.isYou) || a.email.localeCompare(b.email),
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Link
            href="/vaults/"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            ← All vaults
          </Link>
          <h1 className="page-title mt-2 text-xl font-semibold">
            Access overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only. To change who can open a vault, use the Members card on
            that vault&apos;s page.
          </p>
        </div>

        {vaults.isError && (
          <LoadError
            title="Could not load your vaults"
            reassurance="Nobody's access has changed — this is the page failing to load."
            onRetry={() => vaults.refetch()}
            retrying={vaults.isFetching}
          />
        )}

        {(vaults.isPending || (vaults.isSuccess && pending)) && (
          <SkeletonRows count={Math.min(vaults.data?.length ?? 3, 6)} />
        )}

        {vaults.isSuccess && vaults.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            You have no vaults yet, so there is no access to show.
          </p>
        )}

        {vaults.isSuccess && !pending && (
          <>
            {failed > 0 && (
              <LoadError
                title={`Could not load members for ${failed} vault${failed === 1 ? "" : "s"}`}
                reassurance="Access is unchanged. Those vaults are left out of the table below."
                onRetry={() =>
                  memberQueries.forEach((q) => {
                    if (q.isError && !isNoRights(q.error)) void q.refetch();
                  })
                }
                retrying={memberQueries.some((q) => q.isFetching)}
              />
            )}

            {skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {skipped} vault{skipped === 1 ? "" : "s"} left out: the server
                does not show you who has access to {skipped === 1 ? "it" : "them"}.
              </p>
            )}

            {columns.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b">
                          <th
                            scope="col"
                            className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium"
                          >
                            Person
                          </th>
                          {columns.map(({ vault }) => (
                            <th
                              key={vault.id}
                              scope="col"
                              className="px-4 py-2 text-left font-medium"
                            >
                              <Link
                                href={`/vaults/detail/?id=${encodeURIComponent(vault.id)}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {vault.name}
                              </Link>
                              <span className="block text-xs font-normal text-muted-foreground">
                                {vault.environment}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([userId, person]) => (
                          <tr key={userId} className="border-b last:border-0">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 whitespace-nowrap bg-card px-4 py-2 text-left font-normal"
                            >
                              {person.email}
                              {person.isYou && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  you
                                </span>
                              )}
                            </th>
                            {columns.map(({ vault, members }) => {
                              const role = members.find(
                                (m) => m.user_id === userId,
                              )?.role;
                              return (
                                <td key={vault.id} className="px-4 py-2">
                                  {role ?? (
                                    <span className="sr-only">No access</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
