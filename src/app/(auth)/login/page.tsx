/**
 * Sign in — credentials, then the second factor if the account has one.
 *
 * ─── One failure here is not a form error ────────────────────────────────────
 *
 * A {@link ServerProofError} means the peer could not prove it holds the
 * account's verifier: it is not the server the account was registered with. That
 * is a security event, not a typo, and it gets its own treatment — the form is
 * replaced rather than annotated, because offering "try again" would invite
 * someone to keep feeding a password to whatever is on the other end.
 *
 * ─── The password stays in state across the code prompt ──────────────────────
 *
 * It has to: the master key cannot be derived until the session exists. It is
 * carried inside the `pending` object and dropped the moment the login finishes
 * or is abandoned. The password field already holds the same string, so this is
 * not a new exposure — see `lib/auth/login.ts`.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  completeSecondFactor,
  login,
  ServerProofError,
  type LoginProgress,
  type SecondFactorRequired,
} from "@/lib/auth/login";
import { useAuthStore } from "@/stores/authStore";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const signedIn = useAuthStore((s) => s.signedIn);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<SecondFactorRequired | null>(null);
  const [stage, setStage] = useState<LoginProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impostor, setImpostor] = useState(false);
  const [busy, setBusy] = useState(false);

  function finish(result: Parameters<typeof signedIn>[0], remaining: number | null) {
    signedIn(result, remaining);
    setPassword("");
    setPending(null);
    router.push("/vaults/");
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login({ email, password, onProgress: setStage });
      if (result.status === "totp-required") {
        setPending(result);
        setBusy(false);
        setStage(null);
        return;
      }
      finish(result.me, result.backupCodesRemaining);
    } catch (err) {
      if (err instanceof ServerProofError) {
        // Deliberately terminal. No retry, no form.
        setImpostor(true);
        setPassword("");
        return;
      }
      setError(credentialsMessage(err));
      setBusy(false);
      setStage(null);
    }
  }

  async function onSecondFactor(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      const result = await completeSecondFactor(pending, code, setStage);
      finish(result.me, result.backupCodesRemaining);
    } catch (err) {
      // The pending token survives a wrong code, so stay on this step rather
      // than sending the user back through the whole exchange.
      setError(secondFactorMessage(err));
      setCode("");
      setBusy(false);
      setStage(null);
    }
  }

  if (impostor) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This is not the server you registered with</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Sign-in completed the password exchange, but the server could not
            prove it holds your account&apos;s verifier. A genuine evnx server
            always can. No session was started and nothing was unlocked.
          </p>
          <p>
            Treat this connection as untrusted. Check the address in the URL bar,
            and do not re-enter your password here.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (pending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor check</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app, or one of your
            recovery codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSecondFactor} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="code">Authenticator or recovery code</Label>
              <Input
                id="code"
                // One field for both: the server accepts a TOTP or a recovery
                // code on the same endpoint, so asking which one it is would be
                // a question the user should not have to answer.
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                required
                disabled={busy}
                placeholder="123456 or ABCDE-FGHIJ"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <DerivationStatus stage={stage} />

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Verify code"}
            </Button>

            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => {
                // Drops the pending object, and with it the password.
                setPending(null);
                setPassword("");
                setCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to reach your vaults.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onCredentials} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
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
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/*
              No "forgot password" link, and this is not an omission. There is no
              reset: the server holds a verifier and ciphertext, and nothing that
              could recover or replace the password. A link promising otherwise
              would be a lie in the one place people are most likely to believe it.
            */}
            <p className="text-xs text-muted-foreground">
              Your master password never leaves this browser, and it cannot be
              reset.
            </p>
          </div>

          <DerivationStatus stage={stage} />

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href="/register/" className="underline underline-offset-4">
              Get started
            </Link>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Verification email lost?{" "}
            <Link href="/verify-email/" className="underline underline-offset-4">
              Send it again
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The server answers a bad password and an unknown address identically, and so
 * does this. Saying "no account with that email" would turn sign-in into an
 * account oracle and undo the care `srp/init` takes to avoid exactly that.
 */
function credentialsMessage(err: unknown): string {
  if (err instanceof Error && err.name === "CryptoError") {
    return `Sign-in could not complete in this browser: ${err.message}`;
  }
  return "That email and password did not match an account.";
}

function secondFactorMessage(err: unknown): string {
  void err;
  // The server returns a bare 401 here whether the code was mistyped, the clock
  // has drifted, or a recovery code was already spent — so name the three rather
  // than guess between them. Three wrong codes trigger a 15-minute lockout.
  return "That code was not accepted. Authenticator codes last 30 seconds, so try the next one — and if they keep failing, check this device's clock. A recovery code can only be used once.";
}
