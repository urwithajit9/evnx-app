/**
 * Changing the master password.
 *
 * ─── Why this card took a phase to arrive ───────────────────────────────────
 *
 * It looks like a settings toggle and is not one. The master key is derived from
 * the password, so changing it re-derives the key and every vault key wrapped
 * under it is re-wrapped — here, in this browser — and swapped atomically. Until
 * the endpoint existed, offering a control that could half-complete would have
 * been worse than offering none.
 *
 * ─── What this form has to say out loud ─────────────────────────────────────
 *
 * ⚠️ **CI breaks.** API tokens keep working — they authenticate, they do not
 * decrypt — but any pipeline holding the master password as a secret fails until
 * that secret is updated. It is the consequence nobody predicts, so the form says
 * it before the button rather than after the change.
 *
 * It does **not** re-key a vault. A former member who kept a vault key is
 * unaffected by this; that is revocation, and it is a different operation. No
 * copy here may blur the two.
 */

"use client";

import { useState } from "react";
import {
  changeMasterPassword,
  type RotationStage,
} from "@/lib/auth/rotate";
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

const STAGE_LABEL: Record<RotationStage, string> = {
  reading: "Reading your vault keys…",
  rewrapping: "Re-wrapping in this browser…",
  proving: "Proving your current password…",
  swapping: "Applying the change…",
  done: "Done",
};

/** Matches the CLI and the server: long enough to be worth deriving from. */
const MIN_LENGTH = 12;

export function ChangePassword() {
  const totpEnabled = useAuthStore((s) => s.user?.totpEnabled ?? false);

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [compromised, setCompromised] = useState(false);

  const [stage, setStage] = useState<RotationStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    vaults: number;
    sessions: number;
    undoUntil: string | null;
  } | null>(null);

  const busy = stage !== null && stage !== "done";
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const ready =
    current.length > 0 &&
    next.length >= MIN_LENGTH &&
    next === confirm &&
    !sameAsOld &&
    (!totpEnabled || code.trim().length > 0);

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setCode("");
    setCompromised(false);
    setStage(null);
    setError(null);
  }

  async function run() {
    setError(null);
    setDone(null);
    try {
      const result = await changeMasterPassword({
        currentPassword: current,
        newPassword: next,
        totpCode: totpEnabled ? code.trim() : undefined,
        compromised,
        onStage: setStage,
      });
      setDone({
        vaults: result.vaults_rewrapped,
        sessions: result.sessions_revoked,
        undoUntil: result.undo_available_until,
      });
      // Cleared immediately: they are password material, and the operation they
      // were needed for is over.
      setCurrent("");
      setNext("");
      setConfirm("");
      setCode("");
      setOpen(false);
      setStage(null);
    } catch (e) {
      // ⚠️ The server's own prose where it has any. A 409 here explains which
      // vault keys it expected, and replacing that with "could not change
      // password" would strand someone with nothing to act on.
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
          (e instanceof Error ? e.message : "That did not work."),
      );
      setStage(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Master password</CardTitle>
        <CardDescription>
          Re-derives your key and re-wraps every vault key in this browser. The
          server only ever sees the results.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {done && (
          <Alert>
            <AlertTitle>Master password changed</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>
                {done.vaults} vault key{done.vaults === 1 ? "" : "s"} re-wrapped
                {done.sessions > 0 &&
                  `, ${done.sessions} other session${done.sessions === 1 ? "" : "s"} signed out`}
                .
              </p>
              {done.undoUntil ? (
                <p>
                  If this was not you, it can be undone until{" "}
                  <span className="font-mono">
                    {new Date(done.undoUntil).toLocaleString()}
                  </span>{" "}
                  by proving your previous password.
                </p>
              ) : (
                <p>No undo was kept, as you asked.</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Nothing was changed</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Change master password
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border p-3">
            <Irreversible title="Your pipelines will need the new password">
              API tokens keep working — a token authenticates, it does not
              decrypt — but any CI holding your master password as a secret will
              fail until you update that secret. Every other signed-in device is
              signed out. This does not re-key a vault: revoking a member is a
              separate action.
            </Irreversible>

            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current master password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                disabled={busy}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New master password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={next}
                disabled={busy}
                onChange={(e) => setNext(e.target.value)}
              />
              {tooShort && (
                <p className="text-sm text-destructive">
                  At least {MIN_LENGTH} characters.
                </p>
              )}
              {sameAsOld && (
                <p className="text-sm text-destructive">
                  That is your current password.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="text-sm text-destructive">
                  These do not match.
                </p>
              )}
            </div>

            {totpEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="rotate-totp">
                  2FA code, or a recovery code
                </Label>
                <Input
                  id="rotate-totp"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
            )}

            {/* ⚠️ The undo is authorised by proving the OLD password. That is
                exactly right when someone else changed it — and exactly wrong
                when the old password is what leaked, since it would hand the
                account straight back. Hence the choice, defaulting to keeping
                the undo: the common case is routine, the common disaster is
                being locked out. */}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={compromised}
                disabled={busy}
                onChange={(e) => setCompromised(e.target.checked)}
              />
              <span>
                My current password may be known to someone else.
                <span className="block text-muted-foreground">
                  Keeps no undo — the change takes effect immediately and cannot
                  be reversed, because an undo would need only the password that
                  leaked.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!ready || busy} onClick={run}>
                {busy ? STAGE_LABEL[stage] : "Change master password"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>

            {busy && (
              <p className="text-sm text-muted-foreground">
                Deriving keys takes a moment per vault. Leave this tab open.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
