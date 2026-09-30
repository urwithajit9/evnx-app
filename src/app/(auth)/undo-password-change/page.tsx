/**
 * Undoing a master-password change.
 *
 * ─── Why this page is outside the session ────────────────────────────────────
 *
 * ⚠️ It has to be. The person who needs it is the person a password change has
 * locked out — signing in is exactly what they cannot do. So the only credential
 * this page can ask for is the one an attacker lacks: the **previous** master
 * password.
 *
 * That is also why it is genuinely useful rather than a convenience. Someone who
 * changed their own password and regretted it can simply change it back from
 * Settings. This page exists for the case where someone else changed it.
 *
 * ─── What it must not reveal ─────────────────────────────────────────────────
 *
 * The server fabricates a challenge when it has nothing to offer, so a wrong
 * password, an address with no pending change, and an address with no account all
 * fail identically. This page says so plainly instead of guessing between them —
 * distinguishing them would rebuild the account oracle `/srp/init` is careful to
 * deny.
 *
 * The alert email sent when a password changes names the CLI equivalent,
 * `evnx auth undo-password-change`. Both reach the same endpoints.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { undoPasswordChange } from "@/lib/auth/rotate";
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

export default function UndoPasswordChangePage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    restored: number;
    orphans: string[];
  } | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await undoPasswordChange(email, password);
      setDone({
        restored: result.vaults_restored,
        orphans: result.vaults_not_in_snapshot,
      });
      setPassword("");
    } catch (err) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your previous password is back</CardTitle>
          <CardDescription>
            {done.restored} vault key{done.restored === 1 ? "" : "s"} restored.
            Every session has been signed out, including whoever made the change.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done.orphans.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>
                {done.orphans.length} vault
                {done.orphans.length === 1 ? "" : "s"} could not be restored
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  They were created after the change, so their keys are wrapped
                  under the password that has just been undone and will not open.
                </p>
                <ul className="font-mono text-xs">
                  {done.orphans.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
                <p>
                  Delete them, or change the password again to reach them.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <AlertTitle>If you did not ask for that change</AlertTitle>
            <AlertDescription>
              Someone knew your master password. Sign in and change it from
              Settings, and tick the box saying it may be known to someone else —
              that leaves no undo, which is what you want once the old password is
              the thing at risk.
            </AlertDescription>
          </Alert>

          <Button asChild>
            <Link href="/login/">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Undo a master password change</CardTitle>
        <CardDescription>
          Enter the password you used <strong>before</strong> the change. Nothing
          else can authorise this — evnx has never held your password, and there
          is no reset.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={run} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Nothing was restored</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="undo-email">Email</Label>
            <Input
              id="undo-email"
              type="email"
              autoComplete="username"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="undo-password">Previous master password</Label>
            <Input
              id="undo-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? "Deriving your previous key…" : "Restore my previous password"}
          </Button>

          <p className="text-sm text-muted-foreground">
            An undo is only available for a limited window after a change, and
            only when the change kept one.{" "}
            <Link href="/login/" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * One message for every failure, deliberately.
 *
 * ⚠️ The server answers a wrong password, an address with nothing to undo, and an
 * unknown address identically — it fabricates a challenge rather than admitting
 * it has none. Naming which one happened would turn this page into a way to
 * discover who has an evnx account, and to discover whose password was recently
 * changed, which is worse.
 */
function failureMessage(err: unknown): string {
  if (err instanceof Error && err.name === "CryptoError") {
    return `This could not complete in your browser: ${err.message}`;
  }
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 423) {
    return "Too many attempts. This unlocks on its own after fifteen minutes, and is counted separately from sign-in.";
  }
  if (status === 429) {
    return "Too many attempts from here. Wait fifteen minutes and try again.";
  }
  return "That did not work. evnx cannot tell you why: the server answers a wrong password exactly as it answers an account with nothing to undo, so that this page cannot be used to discover who has an account. Check the address, and make sure you are entering the password you used before the change.";
}
