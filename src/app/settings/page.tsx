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
 * **Display name.** `users` has no such column and no endpoint sets one.
 *
 * ─── What arrived, and why it was absent so long ─────────────────────────────
 *
 * **Change password** used to be listed above as deliberately missing: it looks
 * like a settings toggle and is not one, and until the endpoint existed a control
 * that could half-complete would have been worse than none. Both are now built —
 * the swap is atomic server-side, and the browser verifies its own re-wrapping
 * before sending it, which is the one check the server structurally cannot make.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { TwoFactor } from "@/components/settings/two-factor";
import { Sessions } from "@/components/settings/sessions";
import { Devices } from "@/components/settings/devices";
import { ApiTokens } from "@/components/settings/api-tokens";
import { ChangePassword } from "@/components/settings/change-password";
import { PlanUsage } from "@/components/settings/plan-usage";
import { ExportData } from "@/components/settings/export-data";
import { DeleteAccount } from "@/components/settings/delete-account";
import { AppShell } from "@/components/shell/app-shell";
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
    <AppShell>
      <div className="space-y-6">
      <h1 className="page-title text-xl font-semibold">Settings</h1>

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

      {/* First: it is the only read-only card here, and it frames what the
          rest of the page is operating inside. */}
      <PlanUsage />
      <TwoFactor />
      <ChangePassword />
      <Sessions />
      {/* Immediately after Sessions, because the two are the pair someone
          arrives looking for after a login alert — and because the difference
          between them is easiest to read side by side: a session is a live
          credential, a device is somewhere you have signed in from. */}
      <Devices />
      <ApiTokens />
      {/* Before Delete, deliberately: Article 20 and Article 17 are a pair, and
          someone about to erase an account should see that they can take the
          data with them first — not discover it afterwards. */}
      <ExportData />
      {/* Last, and visually separate: the one control here that cannot be undone. */}
      <DeleteAccount />
      </div>
    </AppShell>
  );
}
