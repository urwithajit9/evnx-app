/**
 * Placeholder landing page for a signed-in session.
 *
 * E3 replaces this with the vault list. It exists now because sign-in has to
 * land somewhere, and because it is the only screen that shows the two halves of
 * a session separately — a token *and* a master key in the Worker. They are lost
 * at different moments, and a page that conflates them hides the bug where one
 * survives without the other.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useKeyStore } from "@/stores/keyStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function VaultsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const backupCodesRemaining = useAuthStore((s) => s.backupCodesRemaining);
  const signOut = useAuthStore((s) => s.signOut);
  const unlocked = useKeyStore((s) => s.unlocked);

  // Zustand state does not survive a reload, and neither does the master key —
  // so an unlocked session cannot be restored, only started again.
  //
  // `unlocked` is the render guard on its own; an extra `checked` flag set from
  // inside the effect would be both redundant and an extra render pass.
  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  if (!unlocked || !user) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your vaults</h1>
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

      {!user.emailVerified && (
        <Alert>
          <AlertTitle>Verify your email to use vaults</AlertTitle>
          <AlertDescription>
            You are signed in, but vault operations stay unavailable until{" "}
            {user.email} is confirmed.
          </AlertDescription>
        </Alert>
      )}

      {backupCodesRemaining !== null && backupCodesRemaining <= 3 && (
        <Alert variant="destructive">
          <AlertTitle>
            {backupCodesRemaining} recovery code
            {backupCodesRemaining === 1 ? "" : "s"} left
          </AlertTitle>
          <AlertDescription>
            Reissue them before you run out. At zero, losing your authenticator
            locks the account permanently — the server holds only ciphertext and
            cannot let you back in.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Vault listing arrives in E3. This page currently just shows that the
            session is real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Verified</dt>
            <dd>{user.emailVerified ? "yes" : "not yet"}</dd>
            <dt className="text-muted-foreground">Two-factor</dt>
            <dd>{user.totpEnabled ? "enabled" : "not enabled"}</dd>
            <dt className="text-muted-foreground">Keys</dt>
            <dd>{unlocked ? "in the Worker, not in JavaScript" : "locked"}</dd>
          </dl>
        </CardContent>
      </Card>
    </main>
  );
}
