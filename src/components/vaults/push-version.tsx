/**
 * Push a `.env` into a vault.
 *
 * Two ways in — pick a file, or paste the text — because both are real. A file
 * is what you have locally; paste is what you have when the secrets came out of
 * a password manager or another machine's terminal.
 *
 * ─── The file path reads bytes, the paste path encodes them ──────────────────
 *
 * A picked file is read with `arrayBuffer()` and pushed **unmodified**, so a
 * round trip through the CLI is byte-identical — including a CRLF line ending or
 * a missing trailing newline. Pasted text is encoded as UTF-8, which is the only
 * thing it can be; a textarea has no bytes of its own.
 *
 * ─── A conflict stops here ───────────────────────────────────────────────────
 *
 * On 409 this shows what happened and does nothing else. Re-sealing
 * automatically would overwrite whoever pushed in between, and they would never
 * know. The user decides.
 */

"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pushVersion, VersionConflictError } from "@/lib/vaults/push";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PushVersion({ vaultId }: { vaultId: string }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflictError | null>(null);
  const [done, setDone] = useState<{ version: number; keys: number } | null>(null);

  async function push(plaintext: Uint8Array) {
    setError(null);
    setConflict(null);
    setDone(null);
    setBusy(true);
    try {
      const result = await pushVersion(vaultId, plaintext);
      setDone({ version: result.versionNum, keys: result.keyNames.length });
      setText("");
      if (fileInput.current) fileInput.current.value = "";
      await qc.invalidateQueries({ queryKey: ["versions", vaultId] });
      await qc.invalidateQueries({ queryKey: ["vaults"] });
    } catch (e) {
      if (e instanceof VersionConflictError) setConflict(e);
      else setError(e instanceof Error ? e.message : "Could not push.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Bytes, not text: reading as a string and re-encoding would silently
    // normalise line endings and lose the byte-identity guarantee.
    const buffer = await file.arrayBuffer();
    await push(new Uint8Array(buffer));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push a new version</CardTitle>
        <CardDescription>
          Encrypted in this browser before upload. Only the key names travel in
          the clear, so the vault can be listed without being decrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {done && (
          <Alert>
            <AlertTitle>Pushed as v{done.version}</AlertTitle>
            <AlertDescription>
              {done.keys} key{done.keys === 1 ? "" : "s"} recorded.
            </AlertDescription>
          </Alert>
        )}

        {conflict && (
          <Alert variant="destructive">
            <AlertTitle>Someone else pushed first</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{conflict.message}</p>
              <p>
                Open v{conflict.remoteVersion} above to see what changed, then
                push again from the merged result. Nothing was uploaded.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="push-file">From a file</Label>
          <input
            id="push-file"
            ref={fileInput}
            type="file"
            disabled={busy}
            onChange={onFile}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Uploaded byte for byte — line endings, comments and ordering all
            survive a round trip through the CLI.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="push-text">Or paste the contents</Label>
          <textarea
            id="push-text"
            rows={8}
            disabled={busy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"DATABASE_URL=postgresql://…\nAPI_KEY=…"}
            className="w-full rounded-md border bg-transparent p-3 font-mono text-xs"
            // Nothing typed here should reach a spell-checker or an autofill
            // store. Some of it is a live credential.
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
          />
          <Button
            disabled={busy || text.length === 0}
            onClick={() => push(new TextEncoder().encode(text))}
          >
            {busy ? "Encrypting and pushing…" : "Push pasted contents"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
