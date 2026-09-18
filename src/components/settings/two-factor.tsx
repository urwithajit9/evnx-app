/**
 * Two-factor lifecycle: enrol, reissue recovery codes, disable.
 *
 * ─── Enrolment is two steps because it has to be ─────────────────────────────
 *
 * `/totp/setup` issues a secret held **unconfirmed** in Valkey for ten minutes;
 * `/totp/confirm` attaches it to the account only after a working code proves
 * the authenticator actually has it. Abandoning the flow half-way therefore
 * leaves nothing behind. A one-step "turn on 2FA" would be able to lock someone
 * out of their own account with a mistyped secret.
 *
 * ─── Disabling needs a code, not just a session ──────────────────────────────
 *
 * Otherwise a stolen session could strip the protection it exists to defeat.
 * Same for reissuing recovery codes — that invalidates the old set, so it is a
 * privileged act too.
 */

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  totpConfirm,
  totpDisable,
  totpRegenerateBackupCodes,
  totpSetup,
  type TotpSetup,
} from "@/lib/api/account";
import { getMe } from "@/lib/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { apiErrorCode } from "@/lib/api/client";
import { TotpQr, groupSecret } from "./totp-qr";
import { SecretList } from "./secret-list";
import { ZeroKnowledge } from "@/components/shell/zero-knowledge";
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

type Mode = "idle" | "enrolling" | "disabling" | "reissuing";

export function TwoFactor() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = user?.totpEnabled ?? false;

  async function syncUser() {
    const me = await getMe();
    refreshUser(me);
    await qc.invalidateQueries({ queryKey: ["sessions"] });
  }

  function reset() {
    setMode("idle");
    setSetup(null);
    setCode("");
    setError(null);
  }

  async function beginEnrol() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await totpSetup());
      setMode("enrolling");
    } catch (e) {
      setError(message(e, "Could not start two-factor setup."));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<void>, wrong: string) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(message(e, wrong));
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  // ── The one-shot recovery codes take over the card until acknowledged ──────
  if (codes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recovery codes</CardTitle>
        </CardHeader>
        <CardContent>
          <SecretList
            title="Save these now — they are shown once"
            description="Each works once, in place of an authenticator code. They are the only way back in if you lose your phone, and the server keeps only hashes, so nobody can reissue them for you."
            values={codes}
            filename="evnx-recovery-codes.txt"
            onAcknowledge={() => {
              setCodes(null);
              reset();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          {enabled
            ? "Enabled. Sign-in asks for a code from your authenticator."
            : "Not enabled. Your master password is currently the only thing between an attacker and your account."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {mode === "enrolling" && setup && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-6">
              <TotpQr uri={setup.totp_uri} />
              <div className="min-w-0 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Scan this with your authenticator, or type the key in:
                </p>
                <code className="block break-all rounded-md bg-muted p-2 font-mono text-sm">
                  {groupSecret(setup.secret_base32)}
                </code>
                <ZeroKnowledge>
                  This code is drawn in your browser — the key is never sent to
                  an image service.
                </ZeroKnowledge>
                <p className="text-xs text-muted-foreground">
                  Setup expires in 10 minutes, and nothing changes on your
                  account until you confirm below.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="enrol-code">Enter the 6-digit code to confirm</Label>
              <Input
                id="enrol-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                disabled={busy || code.length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await totpConfirm(code);
                    setCodes(result.backup_codes);
                    await syncUser();
                  }, "That code was not accepted. Authenticator codes last 30 seconds — try the next one, and check this device's clock if they keep failing.")
                }
              >
                {busy ? "Confirming…" : "Confirm and enable"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(mode === "disabling" || mode === "reissuing") && (
          <div className="space-y-3">
            <Alert variant={mode === "disabling" ? "destructive" : undefined}>
              <AlertTitle>
                {mode === "disabling"
                  ? "Turning two-factor off"
                  : "Reissuing recovery codes"}
              </AlertTitle>
              <AlertDescription>
                {mode === "disabling"
                  ? "This also deletes your recovery codes. A current code is required — a session alone is not enough, or a stolen one could strip your second factor."
                  : "Your existing recovery codes stop working the moment new ones are issued."}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="confirm-code">Authenticator or recovery code</Label>
              <Input
                id="confirm-code"
                autoComplete="one-time-code"
                placeholder="123456 or ABCDE-FGHIJ"
                value={code}
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant={mode === "disabling" ? "destructive" : "default"}
                disabled={busy || code.length === 0}
                onClick={() =>
                  mode === "disabling"
                    ? run(async () => {
                        await totpDisable(code);
                        await syncUser();
                        reset();
                      }, "That code was not accepted, so two-factor is still on.")
                    : run(async () => {
                        const result = await totpRegenerateBackupCodes(code);
                        setCodes(result.backup_codes);
                      }, "That code was not accepted, so your existing codes still work.")
                }
              >
                {busy
                  ? "Checking…"
                  : mode === "disabling"
                    ? "Turn off two-factor"
                    : "Issue new codes"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            {!enabled && (
              <Button onClick={beginEnrol} disabled={busy}>
                {busy ? "Starting…" : "Enable two-factor"}
              </Button>
            )}
            {enabled && (
              <>
                <Button variant="outline" onClick={() => setMode("reissuing")}>
                  New recovery codes
                </Button>
                <Button variant="outline" onClick={() => setMode("disabling")}>
                  Turn off
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The server answers a wrong second factor with a bare 401 and no detail, by
 * design — so the caller's own sentence is the useful one, and it says what is
 * still true ("two-factor is still on") rather than guessing why.
 *
 * A `VALIDATION` code is different: that one carries a specific, actionable
 * message, such as the setup having expired out of Valkey.
 */
function message(e: unknown, fallback: string): string {
  if (apiErrorCode(e) === "VALIDATION" && e instanceof Error) {
    return e.message;
  }
  return fallback;
}
