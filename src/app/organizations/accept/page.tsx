/**
 * Redeem an organisation invitation.
 *
 * ─── ⚠️ This route is a hard requirement, not a convenience ──────────────────
 *
 * The invitation email links here — `{PUBLIC_APP_URL}/organizations/accept/?token=…`,
 * built in `services/email.rs::send_org_invite`. If this page does not exist,
 * every invitation email is a dead link. The two have to move together.
 *
 * ─── Why the outcome is vague, and must stay vague ──────────────────────────
 *
 * ⚠️ The server answers **identically** for a wrong token, an expired one, one
 * already used, and one addressed to somebody else — a single 422 with one
 * message. That is deliberate: distinguishing them would turn the endpoint into
 * an oracle for which invitations exist and who they were sent to.
 *
 * So this page must not guess which happened, and must not offer a "resend" that
 * implies it knows. It reports what the server said and names the one thing the
 * reader can check: whether they are signed in as the invited address.
 *
 * ─── Joining assigns no seat ────────────────────────────────────────────────
 *
 * The obvious expectation is wrong in two ways at once — no seat, and no vault —
 * so the success state says both rather than leaving either to be discovered.
 */

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptInvite, type AcceptedInvite } from "@/lib/api/orgs";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AcceptInvitePage() {
  // `useSearchParams` suspends during prerender and a static export prerenders
  // every route, so the boundary is required. ⚠️ The fallback carries the
  // heading too — without it, the slowest moment of the page has no <h1>.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-lg px-6 py-16">
          <h1 className="page-title text-xl font-semibold">Invitation</h1>
          <p className="mt-2 text-sm text-muted-foreground">Checking…</p>
        </main>
      }
    >
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token")?.trim() ?? "";
  const unlocked = useKeyStore((s) => s.unlocked);
  const user = useAuthStore((s) => s.user);

  const [state, setState] = useState<"idle" | "working" | "done" | "failed">(
    "idle",
  );
  const [joined, setJoined] = useState<AcceptedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ Guards against a double redemption in React's development double-invoke.
  // The invitation is single-use, so firing twice would spend it and then report
  // the second attempt's failure — the user would see "not valid" for an
  // invitation that had just worked.
  const fired = useRef(false);

  useEffect(() => {
    if (!token || !unlocked || fired.current) return;
    fired.current = true;
    setState("working");
    acceptInvite(token)
      .then((r) => {
        setJoined(r);
        setState("done");
      })
      .catch((e) => {
        const r = e as { response?: { data?: { error?: string } } };
        setError(
          r?.response?.data?.error ??
            "That invitation is not valid for this account.",
        );
        setState("failed");
      });
  }, [token, unlocked]);

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Invitation</CardTitle>
            <CardDescription>
              This link is missing its token. Open the link from the invitation
              email exactly as it was sent.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  // ⚠️ Signed out is not a failure — it is the ordinary case, because the link
  // arrives by email and is often opened in a browser with no session. The token
  // is preserved across the sign-in so the person does not have to go back to
  // the email for it.
  if (!unlocked) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Sign in to accept</CardTitle>
            <CardDescription>
              An invitation can only be redeemed by the address it was sent to,
              so this needs you signed in first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() =>
                router.push(
                  `/login/?next=${encodeURIComponent(
                    `/organizations/accept/?token=${token}`,
                  )}`,
                )
              }
            >
              Sign in
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="page-title text-xl font-semibold">Invitation</h1>

      {state === "working" && (
        <p className="mt-2 text-sm text-muted-foreground">Accepting…</p>
      )}

      {state === "done" && joined && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>You joined {joined.organization}</CardTitle>
            <CardDescription>as {joined.role}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {/* ⚠️ Both corrections at once. Neither is obvious, and finding out
                later feels like something broke. */}
            <p>
              You hold <strong>no seat</strong> yet. An administrator assigns one,
              and that is what decides your plan&apos;s limits.
            </p>
            <p className="text-muted-foreground">
              Membership does not give you access to any vault. A vault is shared
              separately, and only by someone who holds its key.
            </p>
            <Button asChild size="sm">
              <Link href="/organizations/">View organisations</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {state === "failed" && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>That invitation could not be used</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            {/* ⚠️ The server cannot say WHICH of four reasons applied, so this
                names the one thing the reader can actually verify rather than
                listing possibilities as though one could be ruled out. */}
            <p className="text-xs">
              You are signed in as <strong>{user?.email}</strong>. An invitation
              only works for the address it was sent to.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </main>
  );
}
