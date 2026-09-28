/**
 * Who can reach this vault.
 *
 * ─── Why a viewer sees this too ──────────────────────────────────────────────
 *
 * Any member can read the list. Seeing who else holds a key to a vault you hold
 * a key to is not a privilege — it is the minimum needed to notice a grant that
 * should not be there. Restricting it to admins would blind the people most
 * likely to spot one.
 *
 * ─── What is deliberately absent ─────────────────────────────────────────────
 *
 * **Revoking with a re-key.** Rotating a vault key means decrypting every
 * version and re-encrypting it, which the browser can do but which needs the
 * master password and a progress state that survives a tab closing mid-way. The
 * CLI does it today (`evnx vault revoke`); doing it here badly — a half-finished
 * re-key leaves a vault nobody can open — would be worse than not offering it.
 *
 * The plain removal below is offered with that limit stated, not hidden.
 */

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listMembers,
  setMemberRole,
  removeMember,
  ASSIGNABLE_ROLES,
  ROLE_RANK,
  type VaultMember,
  type VaultRole,
} from "@/lib/api/vaults";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Irreversible } from "@/components/shell/zero-knowledge";
import { shareVault } from "@/lib/vaults/share";

export function VaultMembers({ vaultId }: { vaultId: string }) {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ["members", vaultId],
    queryFn: () => listMembers(vaultId),
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VaultMember | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<VaultRole>("developer");

  const you = members.data?.find((m) => m.is_you);
  const yourRank = you ? ROLE_RANK[you.role] : -1;

  async function act<T>(id: string, fn: () => Promise<T>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["members", vaultId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Everyone holding a key to this vault. Sharing wraps the vault key to
          each person&rsquo;s public keys in your browser — the server never sees
          it unwrapped and cannot grant access itself.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── Share ──────────────────────────────────────────────────────────
            ⚠️ Owner only, and that is narrower than the server's rule on
            purpose. The server allows admins to add members, but an admin's own
            copy of the vault key is itself a share — wrapped to their keypair
            rather than sealed under their master key — and re-wrapping from that
            form is not supported. Offering a form that always fails would be
            worse than explaining why it is absent. */}
        {you?.role === "owner" && (
          <form
            className="space-y-2 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const target = shareEmail.trim();
              if (!target) return;
              act("share", async () => {
                await shareVault(vaultId, target, shareRole);
                setShareEmail("");
              });
            }}
          >
            <label htmlFor="share-email" className="text-sm font-medium">
              Share with
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="share-email"
                type="email"
                required
                autoComplete="off"
                placeholder="them@example.com"
                value={shareEmail}
                disabled={busy === "share"}
                onChange={(e) => setShareEmail(e.target.value)}
                className="min-w-0 flex-1 rounded-md border bg-[var(--bg-surface)] p-1.5 text-sm text-foreground"
              />
              <select
                aria-label="Role to grant"
                value={shareRole}
                disabled={busy === "share"}
                onChange={(e) => setShareRole(e.target.value as VaultRole)}
                className="rounded-md border bg-[var(--bg-surface)] p-1.5 text-xs text-foreground"
              >
                {ASSIGNABLE_ROLES.filter((r) => yourRank > ROLE_RANK[r]).map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ),
                )}
              </select>
              <Button type="submit" size="sm" disabled={busy === "share"}>
                {busy === "share" ? "Sharing…" : "Share"}
              </Button>
            </div>
            {/* Said where the action is, not buried in a doc. Sharing is the one
                moment the zero-knowledge guarantee narrows, and the person doing
                it is the one who should know. */}
            <p className="text-xs text-muted-foreground">
              The vault key is re-wrapped in your browser to their public keys,
              which <strong>the server supplies</strong> — so a malicious server
              could substitute its own and read what you share from then on.
              Fingerprint verification is not built yet.
            </p>
          </form>
        )}

        {you && you.role !== "owner" && yourRank >= ROLE_RANK.admin && (
          <p className="rounded-lg border p-3 text-xs text-muted-foreground">
            You can change roles and remove members here, but only the owner can
            add one: your own copy of the vault key is wrapped to your keypair
            rather than sealed under your password, and re-sharing from that form
            is not supported.
          </p>
        )}

        {members.isPending && (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        )}

        {members.data && (
          <ul className="divide-y">
            {members.data.map((m) => {
              const theirRank = ROLE_RANK[m.role];
              // You may act on someone only if you outrank them — the same rule
              // the server enforces, mirrored so the UI does not offer buttons
              // that will 403.
              const canAct = yourRank > theirRank;
              return (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.email}
                      {m.is_you && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          you
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.role}
                      {m.granted_at &&
                        ` · since ${new Date(m.granted_at).toLocaleDateString()}`}
                    </p>
                    {!m.has_mlkem_key && (
                      <p className="mt-1 text-xs text-[var(--warning)]">
                        No post-quantum key — they must sign in once before this
                        vault can be re-keyed.
                      </p>
                    )}
                  </div>

                  {canAct && (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Role for ${m.email}`}
                        className="rounded-md border bg-[var(--bg-surface)] p-1.5 text-xs text-foreground"
                        value={m.role}
                        disabled={busy === m.user_id}
                        onChange={(e) =>
                          act(m.user_id, () =>
                            setMemberRole(
                              vaultId,
                              m.user_id,
                              e.target.value as VaultRole,
                            ),
                          )
                        }
                      >
                        {ASSIGNABLE_ROLES.filter(
                          // You can only assign a role you outrank, so an admin
                          // cannot mint a peer neither of them could remove.
                          (r) => yourRank > ROLE_RANK[r],
                        ).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === m.user_id}
                        onClick={() => setConfirming(m)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {confirming && (
          <Alert variant="destructive">
            <AlertTitle>
              Remove {confirming.email} from this vault?
            </AlertTitle>
            <AlertDescription className="space-y-3">
              <Irreversible title="This does not rotate the vault key">
                Their access is removed going forward, but the key they already
                hold still works.
              </Irreversible>
              {/* ⚠️ Said plainly rather than buried. A removal without a re-key
                  leaves the old key in their hands, so they can still decrypt
                  everything they had — including versions pushed afterwards. */}
              <p className="text-xs">
                They keep a working copy of the vault key, so they could still
                decrypt versions pushed after this. To rotate the key as well,
                use{" "}
                <code className="rounded bg-muted px-1">
                  evnx vault revoke
                </code>{" "}
                in the CLI — and either way, rotate the affected secrets at their
                source.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === confirming.user_id}
                  onClick={async () => {
                    const target = confirming;
                    setConfirming(null);
                    await act(target.user_id, () =>
                      removeMember(vaultId, target.user_id),
                    );
                  }}
                >
                  Remove without re-keying
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
