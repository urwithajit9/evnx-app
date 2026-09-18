/**
 * Settings — two-factor, sessions, API tokens.
 *
 * All three already existed on the server and nothing in the browser reached
 * them. The consequence for two-factor is worth stating plainly: until this
 * page, **enrolment was only possible from the CLI**, so a dashboard-only user
 * had no second factor available at all.
 *
 * ─── What is deliberately absent ─────────────────────────────────────────────
 *
 * **Change password.** It looks like a settings toggle and is not one: the
 * master key is derived from the password, so changing it re-derives the key and
 * every wrapped vault key has to be re-wrapped in the same transaction. There is
 * no endpoint, and offering a control that could half-complete would be worse
 * than offering none. Phase 4.
 *
 * **Display name.** `users` has no such column and no endpoint sets one.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { TwoFactor } from "@/components/settings/two-factor";
import { Sessions } from "@/components/settings/sessions";
import { ApiTokens } from "@/components/settings/api-tokens";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SettingsPage() {
  const router = useRouter();
  const unlocked = useKeyStore((s) => s.unlocked);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  if (!unlocked || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/vaults/"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Your vaults
        </Link>
        <h1 className="page-title mt-2 text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </div>

      {!user.totpEnabled && (
        <Alert>
          <AlertTitle>No second factor on this account</AlertTitle>
          <AlertDescription>
            Your master password protects the vault contents even from us — but
            it is the only thing protecting the account itself. An authenticator
            app takes a minute to set up.
          </AlertDescription>
        </Alert>
      )}

      <TwoFactor />
      <Sessions />
      <ApiTokens />
    </main>
  );
}
