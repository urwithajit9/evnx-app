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

import { useEffect } from "react";
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
import { AppShell } from "@/components/shell/app-shell";
import { SkeletonRows } from "@/components/ui/skeleton";
import { OnboardingChecklist } from "@/components/vaults/onboarding-checklist";
import { useOnboarding } from "@/lib/onboarding";
import { upgradeHref } from "@/lib/config";

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

  if (!unlocked || !user) return null;

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
      {user.emailVerified && usage.data && (
        <p className="text-sm text-muted-foreground">
          {isFull(usage.data.vaults) ? (
            <span className="font-medium text-destructive">
              {usageLabel(usage.data.vaults)} vaults — full. Delete one you no
              longer need to free a slot
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
              vaults used on the {usage.data.plan} plan
            </>
          )}
        </p>
      )}

      <OnboardingChecklist
        state={onboarding}
        vaults={vaults.data}
        email={user.email}
      />

      {user.emailVerified && <CreateVault />}

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
        <ul className="space-y-3">
          {vaults.data.map((v) => (
            <VaultRow key={v.id} vault={v} />
          ))}
        </ul>
      )}
      </div>
    </AppShell>
  );
}

function VaultRow({ vault }: { vault: VaultSummary }) {
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
          {vault.version_count} version{vault.version_count === 1 ? "" : "s"} ·{" "}
          {vault.role} · updated {formatWhen(vault.updated_at)}
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
