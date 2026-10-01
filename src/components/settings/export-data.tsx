/**
 * Downloading your data — GDPR Article 20.
 *
 * ─── What this hands over, and what it cannot ───────────────────────────────
 *
 * Article 20 covers what the controller holds. For evnx that is metadata plus
 * opaque ciphertext: which vaults exist, who can reach them, what each version
 * contained by variable NAME, API tokens by name and scope, and this account's
 * activity.
 *
 * ⚠️ **The secrets are not in it, and the absence is structural.** Vault
 * contents are encrypted in this browser under a key derived from the master
 * password, and the server has never held any of those. There is nothing on its
 * side to decrypt with. The downloaded file states this itself and names
 * `evnx cloud pull`, so the explanation survives being opened months later in a
 * Downloads folder — this card says it too, because someone is most likely to
 * test the guarantee at exactly this moment.
 *
 * ─── Why the warning about sharing it ───────────────────────────────────────
 *
 * No secret value appears in the file, which makes it tempting to treat as
 * harmless. It still carries every vault name, every co-member's email address
 * and the variable names of every version — the shape of a system without its
 * contents, which is plenty for someone deciding what to attack.
 *
 * ─── Why the download is built here rather than linked ──────────────────────
 *
 * The endpoint needs an `Authorization` header, so a plain `<a href>` would get
 * a 401. The JSON is fetched through the same axios client as everything else,
 * then turned into a Blob and handed to the browser. The object URL is revoked
 * immediately afterwards: it pins the whole document in memory until it is, and
 * this one can be large.
 */

"use client";

import { useState } from "react";
import { exportAccount } from "@/lib/api/account";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** `evnx-export-2026-10-01.json` — dated, so two downloads do not collide. */
function filename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `evnx-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function ExportData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    let url: string | null = null;
    try {
      const body = await exportAccount();
      // Pretty-printed. The file is meant to be read by a person, and an export
      // nobody can read is a compliance gesture rather than portability.
      const blob = new Blob([JSON.stringify(body, null, 2)], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDone(filename());
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
          (e instanceof Error ? e.message : "That did not work."),
      );
    } finally {
      // ⚠️ Always, including on the error path. An object URL holds the whole
      // blob alive until revoked, and this document can be large.
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download your data</CardTitle>
        <CardDescription>
          Everything the server holds about this account, as a JSON file.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Nothing was downloaded</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {done && (
          <Alert>
            <AlertTitle>Saved {done}</AlertTitle>
            <AlertDescription>
              Your secrets are not in it — see below for how to get those.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">What is in it:</span>{" "}
            your vaults, who can reach them, the history of each version by
            variable <em>name</em>, your API tokens by name and scope, and your
            account activity.
          </p>
          <p>
            <span className="font-medium text-foreground">
              What is not, and cannot be:
            </span>{" "}
            your secrets. They are encrypted in your browser with a key derived
            from your master password, and the server has never held it — so
            there is nothing on its side to decrypt them with. To get the values
            themselves, run{" "}
            <code className="font-mono text-xs">evnx cloud pull</code> in each
            project.
          </p>
          <p>
            Nothing usable as a credential is included either — not your
            password material, your 2FA secret, or your API token values.
          </p>
        </div>

        <Alert>
          <AlertTitle>Still worth keeping private</AlertTitle>
          <AlertDescription>
            No secret value appears in the file, but it does list your vault
            names, your variable names, and the email address of everyone you
            share a vault with. That describes the shape of your setup even
            without its contents.
          </AlertDescription>
        </Alert>

        <Button onClick={run} disabled={busy}>
          {busy ? "Preparing…" : "Download my data"}
        </Button>
      </CardContent>
    </Card>
  );
}
