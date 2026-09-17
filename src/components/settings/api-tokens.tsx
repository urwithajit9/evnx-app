/**
 * CI/CD API tokens.
 *
 * ─── What a token can and cannot do ──────────────────────────────────────────
 *
 * Scope is enforced centrally in the server's `require_verified` guard, not in
 * each handler, so the rules hold everywhere:
 *
 *   * a **read** token is refused anything that is not a safe method, stated as
 *     an allow-list so a verb added to the router later is refused by default;
 *   * a token scoped to a **vault** reaches only that vault, and routes with no
 *     `:vault_id` — listing or creating vaults — are refused outright, because
 *     enumerating your vaults is outside what a deploy token was issued for;
 *   * no token can reach this page. Minting one requires a real login, so a
 *     leaked token cannot mint itself a wider, longer-lived replacement and
 *     survive revocation of the original.
 *
 * ─── The raw token is returned exactly once ──────────────────────────────────
 *
 * The server stores a BLAKE3 hash. Losing it means revoking and reissuing; there
 * is no "show again".
 */

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createToken, listTokens, revokeToken, type ApiToken } from "@/lib/api/account";
import { listVaults } from "@/lib/api/vaults";
import { SecretList } from "./secret-list";
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

export function ApiTokens() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: listTokens });
  const vaults = useQuery({ queryKey: ["vaults"], queryFn: listVaults });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_write">("read");
  const [vaultId, setVaultId] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("create");
    try {
      const days = Number(expiresInDays);
      const result = await createToken({
        name: name.trim(),
        scope,
        ...(vaultId ? { vault_id: vaultId } : {}),
        // 0 or blank means no expiry. Sending `0` would be a token that expired
        // the moment it was issued.
        ...(Number.isFinite(days) && days > 0 ? { expires_in_days: days } : {}),
      });
      setIssued({ token: result.raw_token, name: result.name });
      setName("");
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["tokens"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token.");
    } finally {
      setBusy(null);
    }
  }

  if (issued) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token “{issued.name}” created</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SecretList
            title="Copy it now — it is shown once"
            description="The server keeps only a hash and cannot show it again. Put it straight into your CI secret store; if you lose it, revoke it and issue another."
            values={[issued.token]}
            filename={`evnx-token-${issued.name}.txt`}
            onAcknowledge={() => setIssued(null)}
          />
          <p className="text-xs text-muted-foreground">
            In a pipeline:{" "}
            <code className="rounded bg-muted px-1">EVNX_TOKEN</code> in the
            environment, then <code className="rounded bg-muted px-1">evnx cloud pull</code>.
            The <code className="rounded bg-muted px-1">evnx_tok_</code> prefix is
            deliberate — <code className="rounded bg-muted px-1">evnx scan</code>{" "}
            recognises it, so a token committed by accident is detectable.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For CI/CD, where there is no password to type. Scope them down: a
          read-only token cannot push, and a vault-scoped one cannot even list
          your other vaults.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {tokens.isPending && (
          <p className="text-sm text-muted-foreground">Loading tokens…</p>
        )}

        {tokens.data && tokens.data.length > 0 && (
          <ul className="divide-y">
            {tokens.data.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                vaultName={vaults.data?.find((v) => v.id === t.vault_id)?.name}
                busy={busy === t.id}
                onRevoke={async () => {
                  setBusy(t.id);
                  try {
                    await revokeToken(t.id);
                    await qc.invalidateQueries({ queryKey: ["tokens"] });
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Could not revoke it.",
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            ))}
          </ul>
        )}

        {tokens.data?.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        )}

        {creating ? (
          <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                required
                autoFocus
                placeholder="github-actions-deploy"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                For you, not the server — it is how you will recognise this token
                in the list when deciding whether to revoke it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token-scope">Scope</Label>
              <select
                id="token-scope"
                className="w-full rounded-md border bg-transparent p-2 text-sm"
                value={scope}
                onChange={(e) => setScope(e.target.value as "read" | "read_write")}
              >
                <option value="read">read — pull only</option>
                <option value="read_write">read_write — pull and push</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Most pipelines only pull. Start with read.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token-vault">Vault</Label>
              <select
                id="token-vault"
                className="w-full rounded-md border bg-transparent p-2 text-sm"
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
              >
                <option value="">All vaults</option>
                {vaults.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} / {v.environment}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                A vault-scoped token cannot list or create vaults at all — which
                is what you want for a deploy job that needs exactly one.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token-expiry">Expires in (days)</Label>
              <Input
                id="token-expiry"
                inputMode="numeric"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Blank or 0 never expires. An expiry is the one control that still
                works if the token leaks and nobody notices.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={busy === "create" || !name.trim()}>
                {busy === "create" ? "Creating…" : "Create token"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" onClick={() => setCreating(true)}>
            New token
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TokenRow({
  token,
  vaultName,
  busy,
  onRevoke,
}: {
  token: ApiToken;
  vaultName?: string;
  busy: boolean;
  onRevoke: () => void;
}) {
  const expired = token.expires_at ? new Date(token.expires_at) < new Date() : false;
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{token.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {token.scope === "read" ? "read only" : "read and write"} ·{" "}
          {token.vault_id ? (vaultName ?? "one vault") : "all vaults"} ·{" "}
          {token.last_used_at
            ? `last used ${new Date(token.last_used_at).toLocaleString()}`
            : "never used"}
          {token.expires_at &&
            ` · ${expired ? "expired" : "expires"} ${new Date(token.expires_at).toLocaleDateString()}`}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRevoke}>
        {busy ? "Revoking…" : "Revoke"}
      </Button>
    </li>
  );
}
