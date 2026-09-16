/**
 * Create an account.
 *
 * Everything the server receives is derived here — see `lib/auth/register.ts`.
 * This file is only the form around it.
 *
 * Two pieces of copy are load-bearing rather than decorative:
 *
 *   * **"cannot be reset"** — it genuinely cannot. The server holds a verifier
 *     and ciphertext, and nothing that could rebuild the password. Somebody who
 *     skims this and picks a throwaway password loses their vaults, so it is
 *     stated before the field rather than in a footnote after it.
 *   * **the confirm field** — a typo in a password that cannot be reset means an
 *     account nobody can ever open. It is checked locally before any derivation,
 *     so the mistake costs nothing.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register, type RegisterProgress } from "@/lib/auth/register";
import { MIN_PASSWORD_LEN } from "@/lib/auth/credentials";
import { apiErrorCode } from "@/lib/api/client";
import { DerivationStatus } from "@/components/auth/derivation-status";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [stage, setStage] = useState<RegisterProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await register({ email, password, onProgress: setStage });
      // Carry the address so the next screen can name it and offer a resend.
      // It is not a secret, and the alternative is asking for it again.
      router.push(`/verify-email/?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Your keys are generated in this browser. They are never sent anywhere,
          and the server cannot read your secrets even with full database access.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Master password</Label>
            <Input
              id="password"
              type="password"
              // `new-password` so a manager offers to generate and store one.
              autoComplete="new-password"
              required
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LEN} characters. Four or five unrelated words
              beat a short complex string — they are easier to remember and much
              harder to attack.{" "}
              <strong className="font-medium text-foreground">
                This password cannot be reset.
              </strong>{" "}
              It is the only thing that opens your vaults.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm master password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={confirm.length > 0 && confirm !== password}
            />
          </div>

          <DerivationStatus stage={stage} />

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating your account…" : "Create account"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login/" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function messageFor(err: unknown): string {
  // The server's code is the generic `CONFLICT` — `AppError::Conflict` maps
  // every conflict to it — but a conflict on `/auth/register` can only be a
  // duplicate address, so branching on it here is unambiguous. Do not copy this
  // to an endpoint with more than one conflict case.
  //
  // Naming it is right here and wrong elsewhere: the person is at the form and
  // cannot proceed otherwise. `srp/init` and `resend-verification` stay silent
  // about existence because they are reachable by anyone, without an account.
  if (apiErrorCode(err) === "CONFLICT") {
    return "An account already exists for that address. Sign in instead, or use the sign-in page to resend the verification email.";
  }
  return err instanceof Error
    ? err.message
    : "Something went wrong creating your account.";
}
