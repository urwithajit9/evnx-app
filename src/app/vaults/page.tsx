/**
 * Vault list.
 *
 * Everything rendered here is metadata the server legitimately holds — names,
 * environments, roles, counts, timestamps. No decryption happens on this page,
 * so the list draws without touching the Worker.
 *
 * Creating a vault does touch it: a fresh 256-bit key is generated and wrapped
 * under the master key before the request is sent. That is why the form is
 * gated on a verified email — `/vaults` sits behind `require_verified`, and
 * offering a form that can only 403 is worse than not offering one.
 */

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listVaults, type VaultSummary } from "@/lib/api/vaults";
import { useAuthStore } from "@/stores/authStore";
import { useKeyStore } from "@/stores/keyStore";
import { apiErrorStatus } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreateVault } from "@/components/vaults/create-vault";
import { getUsage } from "@/lib/api/account";
import { usageLabel, isFull } from "@/components/settings/plan-usage";
import { SeatNotice } from "@/components/settings/seat-notice";
import { AppShell } from "@/components/shell/app-shell";
import { SkeletonRows } from "@/components/ui/skeleton";
import { OnboardingChecklist } from "@/components/vaults/onboarding-checklist";
import { useOnboarding } from "@/lib/onboarding";
import { upgradeHref } from "@/lib/config";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Which vaults a tab lists. ⚠️ Split on ownership because that is what the
 * plan limit counts: "Owned by you" is exactly the set the `3 / 3` above it
 * is about, and "Shared with you" is the set that costs you nothing.
 */
type VaultTab = "owned" | "shared";

/**
 * The tab named in `?tab=`, if it is one of the two.
 *
 * ⚠️ Read from `window.location`, not `useSearchParams`: under
 * `output: "export"` that requires a Suspense boundary around the whole page
 * (the same reason as `/billing/`). A closed set, so an arbitrary value is
 * ignored rather than passed on.
 */
function tabFromUrl(): VaultTab | undefined {
  const raw = new URLSearchParams(window.location.search).get("tab");
  return raw === "owned" || raw === "shared" ? raw : undefined;
}

export default function VaultsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const backupCodesRemaining = useAuthStore((s) => s.backupCodesRemaining);
  const unlocked = useKeyStore((s) => s.unlocked);

  // A reload drops both the tokens and the master key, and neither can be
  // restored — so there is nothing to rehydrate, only a sign-in to repeat.
  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  const vaults = useQuery({
    queryKey: ["vaults"],
    queryFn: listVaults,
    enabled: unlocked,
  });

  // Additive: a server without /auth/usage simply shows no line, rather than
  // turning the vault list into an error page.
  const usage = useQuery({
    queryKey: ["usage"],
    queryFn: getUsage,
    retry: false,
  });

  // ⚠️ Derived from the two queries above and nothing else — no third request,
  // no stored progress. `ready` gates on the vault list having arrived, so the
  // card cannot flash "create a vault" at someone who has six.
  const onboarding = useOnboarding({
    userId: user?.userId ?? "",
    emailVerified: user?.emailVerified ?? false,
    vaults: vaults.data,
    ready: Boolean(user) && vaults.isSuccess,
  });

  // `null` while billing is sandbox-only — see lib/config/billing.ts.
  const upgrade = upgradeHref();

  // The tab in the address wins until someone picks one here; picking one
  // writes it back, so a reload, Back from a vault, or a pasted link lands on
  // the same tab. `replaceState`, not `pushState`: switching tabs is not a
  // place Back should step through.
  const urlTab = useSyncExternalStore(
    () => () => {},
    tabFromUrl,
    () => undefined,
  );
  const [chosenTab, setChosenTab] = useState<VaultTab | undefined>(undefined);
  function selectTab(tab: VaultTab) {
    setChosenTab(tab);
    const url = new URL(window.location.href);
    if (tab === "owned") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  }

  if (!unlocked || !user) return null;

  // ⓘ Off the list already loaded, not a request. `owner` is set once, at
  // creation, and cannot be granted, so it marks exactly the vaults the limit
  // counts. Empty until the list arrives, which leaves the sentence out.
  const owned = vaults.data?.filter((v) => v.role === "owner") ?? [];
  const shared = vaults.data?.filter((v) => v.role !== "owner") ?? [];
  const sharedCount = shared.length;

  // Owned first, because it is what the plan line above is about — unless
  // there is nothing there and something is shared, so nobody lands on an
  // empty tab with their vaults one click away.
  const tab: VaultTab =
    chosenTab ??
    urlTab ??
    (owned.length === 0 && shared.length > 0 ? "shared" : "owned");

  return (
    <AppShell>
      <div className="space-y-6">
      <h1 className="page-title text-xl font-semibold">Your vaults</h1>

      {backupCodesRemaining !== null && backupCodesRemaining <= 3 && (
        <Alert variant="destructive">
          <AlertTitle>
            {backupCodesRemaining} recovery code
            {backupCodesRemaining === 1 ? "" : "s"} left
          </AlertTitle>
          <AlertDescription>
            Reissue them before you run out. At zero, a lost authenticator locks
            the account permanently — the server holds only ciphertext and cannot
            let you back in.
          </AlertDescription>
        </Alert>
      )}

      {/* ⚠️ Suppressed while the checklist is up, for the same reason the empty
          state below is: the checklist's own "Email verified" step says this,
          in sequence and with the rest of the path around it. Two blocks on one
          page telling someone to go and check the same inbox is not twice the
          nudge. */}
      {!user.emailVerified && !onboarding.visible && (
        <Alert>
          <AlertTitle>Verify your email to use vaults</AlertTitle>
          <AlertDescription>
            Vault routes stay closed until {user.email} is confirmed, so the list
            below will be empty or refused.{" "}
            <Link href="/verify-email/" className="underline underline-offset-4">
              Resend the email
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* ⚠️ Shown beside the create form, not buried in Settings. A vault limit
          discovered at the moment it refuses you is a limit nobody could plan
          around — and this is the moment it applies. */}
      {/* ⚠️ "you own", never bare "vaults". The limit counts vaults you own,
          while the list below also holds vaults shared with you — so a bare
          "3 / 3" above four rows reads as a miscount. */}
      {user.emailVerified && usage.data && (
        <p className="text-sm text-muted-foreground">
          {isFull(usage.data.vaults) ? (
            <span className="font-medium text-destructive">
              {usageLabel(usage.data.vaults)} vaults you own — full. Delete one
              you no longer need to free a slot
              {/* ⚠️ THE PADDLE PLACEHOLDER. This is the only spot in the app
                  where going live changes what a user is told, so it is the
                  only spot that reads the flag. While billing is sandbox-only
                  the sentence ends here: a remedy inside the free plan, and no
                  upsell, because the checkout behind it takes test cards.
                  Flipping `NEXT_PUBLIC_BILLING_LIVE=true` adds the offer. */}
              {upgrade ? (
                <>
                  , or{" "}
                  <Link
                    href={upgrade}
                    className="underline underline-offset-4"
                  >
                    move to a paid plan
                  </Link>
                  .
                </>
              ) : (
                "."
              )}
            </span>
          ) : (
            <>
              <span className="font-mono">{usageLabel(usage.data.vaults)}</span>{" "}
              vaults you own on the {usage.data.plan} plan.
            </>
          )}
          {sharedCount > 0 && (
            <>
              {" "}
              {sharedCount === 1
                ? "The 1 vault shared with you doesn't count."
                : `The ${sharedCount} vaults shared with you don't count.`}
            </>
          )}
        </p>
      )}

      {/* ⚠️ Beside the plan line, because that line is where "free" is read —
          and for someone whose organisation pays, "free" is the sentence that
          looks like a failed payment. */}
      {user.emailVerified && usage.data && <SeatNotice usage={usage.data} />}

      <OnboardingChecklist
        state={onboarding}
        vaults={vaults.data}
        email={user.email}
      />

      {user.emailVerified && (
        <CreateVault onCreated={() => selectTab("owned")} />
      )}

      {/* ⚠️ Row count matches what loaded last time where that is known, so the
          page does not jump twice — once from 1 line to 3 rows, then from 3 to
          six. `usage` knows the count and arrives from a different query. */}
      {vaults.isPending && (
        <SkeletonRows count={usage.data?.vaults.used || 3} />
      )}

      {vaults.isError && <VaultsError error={vaults.error} />}

      {/* ⚠️ Suppressed while the checklist is up. Two "you have no vaults, here
          is how to make one" blocks on one page is worse than either alone —
          the checklist says it better and in sequence. */}
      {vaults.data?.length === 0 && !onboarding.visible && (
        <Card>
          <CardHeader>
            <CardTitle>No vaults yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Use <strong>New vault</strong> above, or the CLI — they produce the
              same thing, and either can read the other&apos;s:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              <code>{"evnx vault create my-app --env production\nevnx cloud push .env --vault my-app"}</code>
            </pre>
          </CardContent>
        </Card>
      )}

      {vaults.data && vaults.data.length > 0 && (
        <Tabs value={tab} onValueChange={(v) => selectTab(v as VaultTab)}>
          <TabsList aria-label="Vaults">
            <TabsTrigger value="owned">
              Owned by you <TabCount n={owned.length} />
            </TabsTrigger>
            <TabsTrigger value="shared">
              Shared with you <TabCount n={shared.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="owned">
            {owned.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You do not own any vaults yet. A vault you create with{" "}
                <strong>New vault</strong> above appears here, and counts
                toward your plan.
              </p>
            ) : (
              <ul className="space-y-3">
                {owned.map((v) => (
                  <VaultRow key={v.id} vault={v} />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="shared" className="space-y-3">
            {shared.length === 0 ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Nothing is shared with you yet. When someone who holds a
                  vault&apos;s key shares it with you, it appears here — and it
                  does not count against your plan. They run:
                </p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  <code>{`evnx vault share <vault> --with ${user.email}`}</code>
                </pre>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Vaults shared with you do not count against your plan. Their
                  versions count against the owner&apos;s.
                </p>
                <ul className="space-y-3">
                  {shared.map((v) => (
                    <VaultRow key={v.id} vault={v} />
                  ))}
                </ul>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
      </div>
    </AppShell>
  );
}

function TabCount({ n }: { n: number }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

function VaultRow({ vault }: { vault: VaultSummary }) {
  // ⓘ On a shared vault the role leads: it is what decides whether you can
  // push, share or delete there. On your own it is always `owner`, which the
  // tab already says.
  const sharedRole = vault.role === "owner" ? null : vault.role;
  return (
    <li>
      <Link
        href={`/vaults/detail/?id=${encodeURIComponent(vault.id)}`}
        className="block rounded-lg border p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-medium">{vault.name}</span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {vault.environment}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {sharedRole && (
            <>
              <span className="text-foreground">{sharedRole}</span> ·{" "}
            </>
          )}
          {vault.version_count} version{vault.version_count === 1 ? "" : "s"} ·
          updated {formatWhen(vault.updated_at)}
        </p>
      </Link>
    </li>
  );
}

function VaultsError({ error }: { error: unknown }) {
  // 403 and 401 mean genuinely different things here and must not share a
  // message. Vault routes are behind `require_verified`: an unverified account
  // is authenticated but refused, which is a 403 and is fixed by opening an
  // email — not by signing in again.
  const status = apiErrorStatus(error);
  if (status === 403) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Your email is not verified yet</AlertTitle>
        <AlertDescription>
          Vault access opens once you confirm your address.{" "}
          <Link href="/verify-email/" className="underline underline-offset-4">
            Resend the verification email
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load your vaults</AlertTitle>
      <AlertDescription>
        {error instanceof Error ? error.message : "Unknown error."}
      </AlertDescription>
    </Alert>
  );
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Locale-formatted on the client only. A static export prerenders this file,
  // and formatting a date during prerender would bake the build machine's
  // locale and timezone into the HTML.
  return d.toLocaleString();
}
