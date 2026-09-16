/**
 * Email verification — one route, two jobs.
 *
 *   * `?token=…` → redeem it and report the outcome.
 *   * no token   → the "check your inbox" screen, with a resend.
 *
 * ─── Why the link should point here, not at the API ──────────────────────────
 *
 * The verification email currently links to
 * `GET {PUBLIC_API_URL}/api/v1/auth/verify-email?token=…`, which redeems the
 * token and returns a small HTML page. That predates this app. Repointing it at
 * `https://app.evnx.dev/verify-email/?token=…` keeps the token out of the API's
 * request logs and its access-log query strings; this page then POSTs it in a
 * body instead. `Referrer-Policy: no-referrer` on the API already stops it
 * leaking onward, and a static export leaks nothing server-side because there is
 * no server.
 *
 * Both paths redeem through the same transactional handler, so the two can
 * coexist while the change is rolled out.
 *
 * ─── Resend says less than you would expect, on purpose ──────────────────────
 *
 * `/auth/resend-verification` always answers 202 — unknown address, already
 * verified, or genuinely pending. Anything more specific would let an
 * unauthenticated caller enumerate who has an account. So the confirmation here
 * is conditional ("if that address needs verifying") and must stay that way.
 */

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { postResendVerification, postVerifyEmail } from "@/lib/api/auth";
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

export default function VerifyEmailPage() {
  // `useSearchParams` suspends during prerender, and a static export prerenders
  // every route. Without this boundary the build fails.
  return (
    <Suspense fallback={<Card><CardHeader><CardTitle>Loading…</CardTitle></CardHeader></Card>}>
      <VerifyEmail />
    </Suspense>
  );
}

type RedeemState = "idle" | "working" | "done" | "failed";

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token");
  const emailFromRegister = params.get("email") ?? "";

  const [redeem, setRedeem] = useState<RedeemState>(token ? "working" : "idle");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    // Guard against React's development double-invoke: the token is single-use,
    // so a second call would report failure for a redemption that just worked.
    started.current = true;
    postVerifyEmail(token)
      .then(() => setRedeem("done"))
      .catch(() => setRedeem("failed"));
  }, [token]);

  if (token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {redeem === "done"
              ? "Your email is verified"
              : redeem === "failed"
                ? "That link did not work"
                : "Verifying…"}
          </CardTitle>
          <CardDescription>
            {redeem === "done" &&
              "Your account is fully active. You can sign in and start pushing vaults."}
            {redeem === "failed" &&
              "Verification links expire, and each one can only be used once — so this is what an already-used or expired link looks like. Request a new one below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {redeem === "done" && (
            <Button asChild className="w-full">
              <Link href="/login/">Sign in</Link>
            </Button>
          )}
          {redeem === "failed" && <ResendForm initialEmail={emailFromRegister} />}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your inbox</CardTitle>
        <CardDescription>
          {emailFromRegister ? (
            <>
              A verification link is on its way to{" "}
              <span className="font-medium text-foreground">{emailFromRegister}</span>
              . Open it to activate your account.
            </>
          ) : (
            "Open the verification link in your email to activate your account."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li>
            1. Open the email from{" "}
            <span className="font-medium text-foreground">noreply@evnx.dev</span>
          </li>
          <li>2. Click the verification link</li>
          <li>3. Come back and sign in</li>
        </ol>

        <p className="text-sm text-muted-foreground">
          You can sign in before verifying, but vault commands stay unavailable
          until your address is confirmed.
        </p>

        <ResendForm initialEmail={emailFromRegister} />

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login/" className="underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function ResendForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postResendVerification(email);
      setSent(true);
    } catch {
      // A 429 is the only failure worth distinguishing: the server allows three
      // an hour, and "try again later" is actionable where "something failed" is
      // not. Everything else stays generic — see the module note on enumeration.
      setError(
        "Could not request another email just now. The limit is three per hour; try again later.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Alert>
        <AlertDescription>
          If that address belongs to an account that still needs verifying, a new
          link is on its way. Check your spam folder too.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="resend-email">Send the verification email again</Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          required
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={busy}>
        {busy ? "Sending…" : "Resend verification email"}
      </Button>
    </form>
  );
}
