/**
 * Vault detail — version history, and the secret viewer.
 *
 * ─── Why `?id=` and not `/vaults/[id]` ───────────────────────────────────────
 *
 * `output: "export"` prerenders every route at build time, and a dynamic segment
 * needs `generateStaticParams` to enumerate its values. Vault ids are UUIDs that
 * exist only in someone's account, so there is nothing to enumerate and the
 * build fails. A query parameter is resolved in the browser, keeps the URL
 * shareable, and costs nothing.
 *
 * ⚠️ Do not "tidy" this into `[id]`. It will build locally against a dev server
 * and fail the export. The vault id is not a secret, so a query string is a fine
 * place for it — unlike the verification token, which is why that one moved to a
 * POST body.
 *
 * ─── What is on screen, and where it came from ───────────────────────────────
 *
 * Version metadata is the server's — it knows sizes, times, and key *names*.
 * Values exist only after this page pulls a blob and decrypts it in the Worker.
 * The server has never held them, and nothing here writes them anywhere: no
 * `localStorage`, no URL, no query cache that outlives the page.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listVaults, listVersions, type VersionMeta } from "@/lib/api/vaults";
import { openVersion } from "@/lib/vaults/open";
import { parseEnv, maskFor, type EnvEntry } from "@/lib/env/parse";
import { useKeyStore } from "@/stores/keyStore";
import { apiErrorStatus } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatWhen } from "../page";
import { PushVersion } from "@/components/vaults/push-version";

export default function VaultDetailPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-muted-foreground">Loading…</main>}>
      <VaultDetail />
    </Suspense>
  );
}

function VaultDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const vaultId = params.get("id");
  const unlocked = useKeyStore((s) => s.unlocked);

  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  const vaults = useQuery({
    queryKey: ["vaults"],
    queryFn: listVaults,
    enabled: unlocked,
  });
  const versions = useQuery({
    queryKey: ["versions", vaultId],
    queryFn: () => listVersions(vaultId!),
    enabled: unlocked && !!vaultId,
  });

  const [opened, setOpened] = useState<{ version: number; text: string } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  if (!unlocked) return null;

  if (!vaultId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>No vault selected</AlertTitle>
          <AlertDescription>
            <Link href="/vaults/" className="underline underline-offset-4">
              Back to your vaults
            </Link>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const vault = vaults.data?.find((v) => v.id === vaultId);

  async function open(versionNum: number) {
    setOpenError(null);
    setOpening(versionNum);
    try {
      // The version number is authenticated into the ciphertext, so it must be
      // the one actually being downloaded — never a separately resolved
      // "latest". See `lib/vaults/open.ts`.
      const result = await openVersion(vaultId!, versionNum);
      setOpened({ version: result.versionNum, text: result.text });
    } catch (e) {
      setOpened(null);
      setOpenError(
        e instanceof Error
          ? `${e.message} — a decryption failure here means the key, the blob or the version do not agree, and the server cannot tell you which.`
          : "Could not open that version.",
      );
    } finally {
      setOpening(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/vaults/"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← All vaults
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {vault ? vault.name : "Vault"}
        </h1>
        {vault && (
          <p className="text-sm text-muted-foreground">
            {vault.environment} · {vault.role} · {vault.version_count} version
            {vault.version_count === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {versions.isError && <LoadError error={versions.error} />}
      {versions.isPending && (
        <p className="text-sm text-muted-foreground">Loading version history…</p>
      )}

      <PushVersion vaultId={vaultId} />

      {versions.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Nothing pushed yet</CardTitle>
            <CardDescription>
              This vault has no versions. Push one above, or from the CLI with{" "}
              <code className="text-xs">
                evnx cloud push .env --vault {vault?.name ?? ""}
              </code>{" "}
              — either client can read the other&apos;s.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {versions.data && versions.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>
              Metadata the server holds. Key names are stored for display; values
              never leave your devices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {versions.data.map((v) => (
                <VersionRow
                  key={v.version_num}
                  meta={v}
                  busy={opening === v.version_num}
                  active={opened?.version === v.version_num}
                  onOpen={() => open(v.version_num)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {openError && (
        <Alert variant="destructive">
          <AlertTitle>Could not decrypt that version</AlertTitle>
          <AlertDescription>{openError}</AlertDescription>
        </Alert>
      )}

      {opened && <SecretViewer version={opened.version} text={opened.text} />}
    </main>
  );
}

function VersionRow({
  meta,
  busy,
  active,
  onOpen,
}: {
  meta: VersionMeta;
  busy: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          v{meta.version_num}
          {active && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              open
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {meta.key_count} key{meta.key_count === 1 ? "" : "s"} ·{" "}
          {meta.blob_size_bytes} bytes · {formatWhen(meta.pushed_at)}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onOpen} disabled={busy}>
        {busy ? "Decrypting…" : active ? "Reopen" : "Open"}
      </Button>
    </li>
  );
}

function SecretViewer({ version, text }: { version: number; text: string }) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw] = useState(false);
  const parsed = parseEnv(text);

  function toggle(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>v{version} contents</CardTitle>
        <CardDescription>
          Decrypted in this browser, in a Web Worker. Values are masked until you
          reveal them and are gone when you leave this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRevealed(
                revealed.size === parsed.entries.length
                  ? new Set()
                  : new Set(parsed.entries.map((e) => e.key)),
              )
            }
          >
            {revealed.size === parsed.entries.length && parsed.entries.length > 0
              ? "Hide all"
              : "Reveal all"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Show parsed" : "Show raw file"}
          </Button>
        </div>

        {showRaw ? (
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
            <code>{text}</code>
          </pre>
        ) : (
          <>
            <ul className="divide-y">
              {parsed.entries.map((e) => (
                <EntryRow
                  key={`${e.key}:${e.line}`}
                  entry={e}
                  revealed={revealed.has(e.key)}
                  onToggle={() => toggle(e.key)}
                />
              ))}
            </ul>

            {parsed.unparsed.length > 0 && (
              <Alert>
                <AlertTitle>
                  {parsed.unparsed.length} line
                  {parsed.unparsed.length === 1 ? "" : "s"} could not be read
                </AlertTitle>
                <AlertDescription>
                  The viewer&apos;s parser is simpler than the CLI&apos;s, and it
                  reports what it cannot read rather than hiding it. Your file is
                  stored and returned byte for byte regardless — use{" "}
                  <strong>Show raw file</strong> to see everything.
                </AlertDescription>
              </Alert>
            )}

            {parsed.entries.length === 0 && parsed.unparsed.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No assignments in this file.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EntryRow({
  entry,
  revealed,
  onToggle,
}: {
  entry: EnvEntry;
  revealed: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-muted-foreground">{entry.key}</p>
        <p className="break-all font-mono text-sm">
          {revealed ? entry.value || <em className="not-italic text-muted-foreground">(empty)</em> : maskFor(entry.value)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {revealed ? "Hide" : "Reveal"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigator.clipboard?.writeText(entry.value)}
        >
          Copy
        </Button>
      </div>
    </li>
  );
}

function LoadError({ error }: { error: unknown }) {
  if (apiErrorStatus(error) === 403) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Your email is not verified yet</AlertTitle>
        <AlertDescription>
          Vault access opens once you confirm your address.{" "}
          <Link href="/verify-email/" className="underline underline-offset-4">
            Resend the verification email
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }
  if (apiErrorStatus(error) === 404) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No such vault</AlertTitle>
        <AlertDescription>
          It may have been deleted, or you may no longer be a member.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load this vault</AlertTitle>
      <AlertDescription>
        {error instanceof Error ? error.message : "Unknown error."}
      </AlertDescription>
    </Alert>
  );
}
