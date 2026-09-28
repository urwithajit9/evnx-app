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
 * ─── Removal offers rotation, and defaults to it ────────────────────────────
 *
 * ⚠️ This file used to say re-keying was "deliberately absent", because a
 * half-finished run was believed to leave a vault nobody could open. **It cannot.**
 * `routes::rekey` validates the whole payload before writing anything and commits
 * in one transaction, and staged blobs go to fresh storage keys that nothing
 * references until the swap — so an abandoned run leaves orphaned objects and a
 * vault that still opens with its old key. The master password is not needed
 * either: the master key is already in the Worker for the length of the session.
 *
 * Both were true of the CLI too, which has done this since Phase 3. The blocker
 * was a belief, not a constraint.
 *
 * So removal now offers **Remove and rotate the key** first, with
 * **Remove without rotating** kept second — it is the right choice when you are
 * rotating separately or the member never held the key, the same escape hatch the
 * CLI spells `--no-rekey`. It was previously the only thing on offer, which made
 * it the default by accident.
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
import { rekeyVault, type RekeyProgress } from "@/lib/vaults/rekey";

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
  const [progress, setProgress] = useState<RekeyProgress | null>(null);

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
              <Irreversible title="Rotating cannot reach backwards">
                They keep any copy they already made of a version they could
                read. Rotation stops them reading anything from now on — so
                either way, <strong>rotate the affected secrets at their
                source</strong>. That is the step people skip.
              </Irreversible>

              {progress && (
                <p className="text-xs">
                  {progress.phase === "re-encrypting"
                    ? `Re-encrypting version ${progress.done + 1} of ${progress.total}…`
                    : progress.phase === "re-wrapping"
                      ? `Re-wrapping the key for ${progress.total} member${progress.total === 1 ? "" : "s"}…`
                      : progress.phase === "committing"
                        ? "Swapping everything over…"
                        : "Reading the vault…"}
                  {" "}
                  {/* Closing the tab is safe and saying so is the point: the
                      swap is one transaction, and an abandoned run leaves
                      orphaned objects nothing references, not a broken vault. */}
                  Leaving this page cancels it safely — nothing changes until the
                  final step.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === confirming.user_id}
                  onClick={async () => {
                    const target = confirming;
                    setConfirming(null);
                    await act(target.user_id, async () => {
                      try {
                        await rekeyVault(vaultId, {
                          removeUserId: target.user_id,
                          onProgress: setProgress,
                        });
                      } finally {
                        setProgress(null);
                      }
                    });
                  }}
                >
                  {busy === confirming.user_id
                    ? "Rotating…"
                    : "Remove and rotate the key"}
                </Button>
                {/* Kept, and second. It is the right choice when you are
                    re-keying separately or the member never held the key — the
                    CLI offers the same escape hatch as `--no-rekey` — but it is
                    no longer the only thing on offer, which is what made it the
                    default by accident. */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === confirming.user_id}
                  onClick={async () => {
                    const target = confirming;
                    setConfirming(null);
                    await act(target.user_id, () =>
                      removeMember(vaultId, target.user_id),
                    );
                  }}
                >
                  Remove without rotating
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === confirming.user_id}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Rotating re-encrypts every version in your browser and re-wraps
                the key for everyone who stays, in one atomic swap. Removing
                without rotating leaves them a working copy of the vault key, so
                they could still decrypt versions pushed after this.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
