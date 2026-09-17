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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreateVault } from "@/components/vaults/create-vault";

export default function VaultsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const backupCodesRemaining = useAuthStore((s) => s.backupCodesRemaining);
  const signOut = useAuthStore((s) => s.signOut);
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

  if (!unlocked || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Your vaults</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/settings/">Settings</Link>
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              router.push("/login/");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

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

      {!user.emailVerified && (
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

      {user.emailVerified && <CreateVault />}

      {vaults.isPending && (
        <p className="text-sm text-muted-foreground">Loading your vaults…</p>
      )}

      {vaults.isError && <VaultsError error={vaults.error} />}

      {vaults.data?.length === 0 && (
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
    </main>
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
