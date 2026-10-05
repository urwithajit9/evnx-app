/**
 * Known devices, and saying one was not you.
 *
 * The login-alert email now says "something looked unusual" and names the
 * reasons. This is where someone goes to look. Without it, the email describes
 * devices a browser user cannot inspect at all — only the CLI could, which is
 * the wrong half of the product to require after a security notice.
 *
 * ─── A device is not a session ───────────────────────────────────────────────
 *
 * ⚠️ They sit next to each other on this page and the copy has to keep them
 * apart. A **session** is a live credential you can revoke. A **device** is
 * somewhere you have signed in from, which may have no session left at all.
 * Revoking a session ends one route in; disavowing a device records a judgement
 * and signs you out everywhere, including here.
 *
 * ─── ⚠️ There is no location in this, and there cannot be ────────────────────
 *
 * The server identifies an origin by a keyed BLAKE3 digest of the client
 * address and the user agent. It holds neither value and can recover neither,
 * so there is no city, no country and no "impossible travel" — those need a raw
 * IP, and evnx never stores one.
 *
 * That is a real cost, honestly paid. A device that looks new is very often a
 * phone that reconnected, and the UI says so rather than letting someone act on
 * a threat that is not there. `sessions.tsx` carries the same note for the same
 * reason; this is the second place that temptation appears.
 *
 * ─── Why disavowing is worth more than the list ──────────────────────────────
 *
 * It is the only thing in the product that produces a **label**. Everything
 * else the server knows about a login is inference; this is the account holder
 * saying so, and the server weighs it above every other signal combined.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  disavowDevice,
  listDevices,
  type DeviceSummary,
} from "@/lib/api/account";
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
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export function Devices() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const devices = useQuery({ queryKey: ["devices"], queryFn: listDevices });

  async function disavow(id: string) {
    setError(null);
    setBusy(true);
    try {
      await disavowDevice(id);
      // The server has already revoked every session, this one included, so the
      // tokens in memory are dead. Going through `signOut` rather than just
      // navigating is what zeroizes the keys in the Worker — dropping the token
      // and leaving a master key behind would be a half-ended session.
      await signOut();
      router.push("/login/?disavowed=1");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not record that. Nothing changed.",
      );
      setBusy(false);
      setConfirming(null);
    }
  }

  const real = (devices.data ?? []).filter((d) => !d.unknown_origin);
  const unknown = (devices.data ?? []).find((d) => d.unknown_origin);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Networks and browsers this account has signed in from. Not the same as
          sessions above — a device can appear here with no session left.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {devices.isPending && (
          <SkeletonRows count={2} />
        )}

        {/*
          ⚠️ Not `return null` on error. A card that vanishes is
          indistinguishable from one that was never designed — the failure
          `plan-usage.tsx` has today and A4 records.
        */}
        {devices.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Could not load your devices. Your account is unaffected — this is
              the list failing, not your sign-ins.
            </AlertDescription>
          </Alert>
        )}

        {devices.data && real.length === 0 && !devices.isPending && (
          <EmptyState title="No sign-ins recorded yet">
            Devices appear here after you sign in from them. This one will show
            up the next time you do.
          </EmptyState>
        )}

        {real.length > 0 && (
          <ul className="divide-y">
            {real.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                busy={busy && confirming === d.id}
                confirming={confirming === d.id}
                disabled={busy}
                onAsk={() => setConfirming(d.id)}
                onCancel={() => setConfirming(null)}
                onConfirm={() => disavow(d.id)}
              />
            ))}
          </ul>
        )}

        {confirming && (
          <Alert variant="destructive">
            <AlertTitle>This signs you out everywhere</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Every session on this account ends, including this one. You will
                need to sign in again.
              </p>
              {/*
                ⚠️ Said before the action, not after. Someone deciding whether
                to click needs to know that signing out is not the part that
                protects them.

                ⚠️ And it says "sign back in and change it from here", not "we
                will take you there next" — which is what it said first and
                was not true. Disavowing signs you out, so the next screen is
                the login page, not the password form. A promise the flow does
                not keep is worse than no promise, especially in a security
                notice.
              */}
              <p>
                <strong>Signing out is not enough on its own.</strong> Your vault
                keys are wrapped under your master password, so whoever had
                access can sign in again until you change it. Sign back in and
                change it from here.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {unknown && (
          <p className="text-xs text-muted-foreground">
            {unknown.sign_in_count} sign-in
            {unknown.sign_in_count === 1 ? "" : "s"} could not be attributed to a
            device — a client behind no proxy, sending no user agent. Shown for
            completeness; there is nothing to disavow.
          </p>
        )}

        {/*
          ⚠️ The note that stops this feature doing harm. Without it, a second
          row reads as an intruder, and the commonest cause is a phone that
          changed network.
        */}
        <p className="text-xs text-muted-foreground">
          A device is a network and browser, not a place. evnx stores a hash of
          each and cannot tell where you were, so a new row can simply mean a
          phone that reconnected or a browser that updated.
        </p>
      </CardContent>
    </Card>
  );
}

function DeviceRow({
  device,
  busy,
  confirming,
  disabled,
  onAsk,
  onCancel,
  onConfirm,
}: {
  device: DeviceSummary;
  busy: boolean;
  confirming: boolean;
  disabled: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          <code className="text-xs">{device.id}</code>
          {device.is_current && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              this browser
            </span>
          )}
          {device.disavowed && (
            <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs font-normal text-destructive">
              you said this was not you
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {device.sign_in_count} sign-in
          {device.sign_in_count === 1 ? "" : "s"} · first {when(device.first_seen)}{" "}
          · last {when(device.last_seen)}
        </p>
      </div>

      {confirming ? (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : "Sign out everywhere"}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={disabled || device.disavowed}
          onClick={onAsk}
        >
          {/* Already disavowed: nothing further to record, and offering the
              button again would imply the first one did not take. */}
          {device.disavowed ? "Reported" : "This wasn't me"}
        </Button>
      )}
    </li>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
