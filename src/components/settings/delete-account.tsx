/**
 * Deleting the account.
 *
 * ─── Why the email has to be typed ──────────────────────────────────────────
 *
 * The same shape GitHub uses for deleting a repository, and for the same reason:
 * a confirm dialog is dismissed reflexively, a typed name is not. The server
 * enforces it too, because a client that forgot to ask would be exactly the
 * client that deletes an account by accident.
 *
 * ⚠️ It is a guard against **mistakes, not attackers** — anyone who reaches this
 * form already knows their own address. The 2FA code is the security control, and
 * the endpoint refuses API tokens outright so a leaked CI credential cannot erase
 * the account it belongs to.
 *
 * ─── Why a shared vault stops it ────────────────────────────────────────────
 *
 * `vaults.owner_id` cascades, so deleting an owner would delete their vaults and
 * every other member's access with them. The server refuses and names them; this
 * form shows that message unchanged, because the resolution — remove the members,
 * or delete the vaults — is the person's to choose and needs the specifics.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount } from "@/lib/api/account";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Irreversible } from "@/components/shell/zero-knowledge";

export function DeleteAccount() {
  const router = useRouter();
  const email = useAuthStore((s) => s.user?.email ?? "");
  const totpEnabled = useAuthStore((s) => s.user?.totpEnabled ?? false);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches =
    !!email && typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(typed.trim(), code.trim() || undefined);
      // The account is gone, so the session cannot be refreshed and the keys in
      // the Worker refer to nothing. `signOut` clears local state first and
      // swallows the server call, which is exactly right here: the logout it
      // sends will 401 because the user it names no longer exists.
      await useAuthStore.getState().signOut();
      // `/login/` with the trailing slash, matching `output: "export"` and the
      // other sign-out paths in this app.
      router.push("/login/");
    } catch (e) {
      // ⚠️ The server's prose, unchanged. A 409 here names the vaults in the way,
      // and replacing it with "could not delete account" would strand someone
      // with no idea what to do next.
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
          (e instanceof Error ? e.message : "That did not work."),
      );
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Removes this account and every vault you are the only member of.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Nothing was deleted</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <Irreversible title="There is no undo, and no support path back">
          Your vaults are encrypted with keys the server has never seen, so
          nobody can restore them — not us, not you. Vaults you share with other
          people will block this until you remove them or delete the vault.
        </Irreversible>

        {!open ? (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete this account
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-email">
                Type <span className="font-mono">{email}</span> to confirm
              </Label>
              <Input
                id="confirm-email"
                autoComplete="off"
                value={typed}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>

            {totpEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-totp">
                  2FA code, or a recovery code
                </Label>
                <Input
                  id="confirm-totp"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {/* Disabled until the address matches, so the destructive button
                  cannot be reached by reflex. */}
              <Button
                variant="destructive"
                disabled={!matches || busy || (totpEnabled && !code.trim())}
                onClick={run}
              >
                {busy ? "Deleting…" : "Delete my account permanently"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setCode("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
