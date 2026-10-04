/**
 * Organisations — billing and a directory.
 *
 * ─── ⛔ The one thing this screen must never imply ───────────────────────────
 *
 * An organisation does **not** give anyone access to a vault. It owns a plan and
 * a set of seats; a seat decides which plan's limits apply to its holder. The
 * server cannot wrap a vault key, so no membership, role or seat can produce
 * vault access — sharing is a separate, deliberate act by someone holding the
 * key.
 *
 * ⚠️ The nearest thing to a mockup for this screen gets it wrong:
 * `phase_3/01-member-management.html` puts a seat meter under *"Manage vault
 * access and roles across your organization"*. That is the exact conflation
 * migration 010, `middleware/org_role.rs` and three layers of server refusal
 * exist to prevent, so this screen was built from the app's own components
 * instead and states the separation in three places: the page description, the
 * invite dialog, and every seat change.
 *
 * ─── A seat is a plan change, and the person it happens to is not here ──────
 *
 * Assigning one moves somebody else's limits. The confirmation says whose and
 * what to — because otherwise they watch their quota move with no explanation,
 * and the person who caused it never knew they had.
 */

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOrg,
  deleteOrg,
  invite as sendInvite,
  isOverSeated,
  listInvites,
  listMembers,
  listOrgs,
  removeMember,
  renderSeats,
  revokeInvite,
  setRole,
  setSeat,
  setSeats,
  type OrgMember,
  type OrgSummary,
} from "@/lib/api/orgs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Said wherever someone might believe otherwise. */
const NOT_VAULT_ACCESS =
  "An organisation decides which plan's limits apply. It does not give anyone access to a vault — share one from the vault itself.";

function apiMessage(e: unknown): string {
  const r = e as { response?: { data?: { error?: string } } };
  return r?.response?.data?.error ?? "Something went wrong. Nothing was changed.";
}

export function Organizations() {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: listOrgs });
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current =
    orgs.data?.find((o) => o.id === selected) ?? orgs.data?.[0] ?? null;

  if (orgs.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (orgs.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load organisations</AlertTitle>
        <AlertDescription>{apiMessage(orgs.error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {orgs.data && orgs.data.length === 0 ? (
        <CreateOrg onDone={() => qc.invalidateQueries({ queryKey: ["orgs"] })} empty />
      ) : (
        <>
          {/* A picker only when there is something to pick between. One
              organisation needs no switcher, and an empty select is chrome
              pretending to be a feature. */}
          {orgs.data && orgs.data.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {orgs.data.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSelected(o.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (current?.id === o.id
                      ? "border-[var(--border-muted)] bg-[var(--bg-overlay)] text-foreground"
                      : "border-[var(--border-subtle)] text-muted-foreground hover:text-foreground")
                  }
                >
                  {o.slug}
                </button>
              ))}
            </div>
          )}

          {current && (
            <OrgDetail org={current} onError={setError} />
          )}

          <CreateOrg onDone={() => qc.invalidateQueries({ queryKey: ["orgs"] })} />
        </>
      )}
    </div>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function OrgDetail({
  org,
  onError,
}: {
  org: OrgSummary;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ["org-members", org.id],
    queryFn: () => listMembers(org.id),
  });

  const isAdmin = org.your_role === "owner" || org.your_role === "admin";
  const isOwner = org.your_role === "owner";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["orgs"] });
    qc.invalidateQueries({ queryKey: ["org-members", org.id] });
  };

  async function act(fn: () => Promise<unknown>) {
    onError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      onError(apiMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{org.name}</CardTitle>
          <CardDescription>
            {org.slug} · {org.plan} plan · you are {org.your_role}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ⚠️ Stated on the screen itself, not only in the docs. "I added them
              to the org, why can't they see the vault?" is the first question
              this feature will produce. */}
          <p className="text-sm text-muted-foreground">{NOT_VAULT_ACCESS}</p>

          <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] px-3 py-2">
            <span className="text-sm">Seats</span>
            <span className="font-mono text-sm">{renderSeats(org.seats)}</span>
          </div>

          {isOverSeated(org.seats) && (
            <Alert>
              <AlertTitle>More seats are assigned than purchased</AlertTitle>
              <AlertDescription>
                Everyone keeps their seat until one is released. Nothing has been
                taken away automatically.
              </AlertDescription>
            </Alert>
          )}

          {isOwner && <SeatCount org={org} onDone={refresh} onError={onError} />}
        </CardContent>
      </Card>

      <Members
        org={org}
        members={members.data ?? []}
        loading={members.isLoading}
        isAdmin={isAdmin}
        isOwner={isOwner}
        act={act}
      />

      {isAdmin && <Invites org={org} onError={onError} />}
      {isOwner && <DangerZone org={org} onError={onError} />}
    </div>
  );
}

// ─── Seat count ───────────────────────────────────────────────────────────────

function SeatCount({
  org,
  onDone,
  onError,
}: {
  org: OrgSummary;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [value, setValue] = useState(
    org.seats.purchased === null ? "" : String(org.seats.purchased),
  );
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="seat-count">
        Purchased seats
      </label>
      <div className="flex gap-2">
        <input
          id="seat-count"
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="unlimited"
          className="w-32 rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            onError(null);
            setBusy(true);
            try {
              await setSeats(org.id, value.trim() === "" ? null : Number(value));
              onDone();
            } catch (e) {
              onError(apiMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {/* ⚠️ Owner-only on the server, and the reason is worth saying: this is
            what an invoice is computed from. */}
        Leave it blank for no limit. This is what billing is based on, so only an
        owner can change it.
      </p>
    </div>
  );
}

// ─── Members ──────────────────────────────────────────────────────────────────

function Members({
  org,
  members,
  loading,
  isAdmin,
  isOwner,
  act,
}: {
  org: OrgSummary;
  members: OrgMember[];
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Who is in the directory, and who holds a seat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {members.map((m) => (
          <div
            key={m.user_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">
                {m.email}
                {m.is_you && (
                  <span className="ml-2 text-xs text-muted-foreground">you</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.role}
                {m.holds_a_seat ? " · holds a seat" : " · no seat"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(() => setSeat(org.id, m.user_id, !m.holds_a_seat))}
                >
                  {m.holds_a_seat ? "Release seat" : "Assign seat"}
                </Button>
              )}

              {/* ⚠️ Owner is absent from the choices, here and on the server and
                  in migration 010's CHECK. An organisation has exactly one, set
                  at creation. */}
              {isOwner && m.role !== "owner" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    act(() =>
                      setRole(org.id, m.user_id, m.role === "admin" ? "member" : "admin"),
                    )
                  }
                >
                  Make {m.role === "admin" ? "member" : "admin"}
                </Button>
              )}

              {m.role !== "owner" && (isAdmin || m.is_you) && (
                confirming === m.user_id ? (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => act(() => removeMember(org.id, m.user_id))}
                    >
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(m.user_id)}
                  >
                    {m.is_you ? "Leave" : "Remove"}
                  </Button>
                )
              )}
            </div>
          </div>
        ))}

        {confirming && (
          <p className="text-xs text-muted-foreground">
            {/* ⚠️ The consequence, before the click. Removal frees the seat and
                drops their limits — more than "they leave the list". */}
            Removing someone frees their seat and drops their limits back to their
            own plan. Nothing they already pulled is recalled, and no vault is
            touched.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Invitations ──────────────────────────────────────────────────────────────

function Invites({
  org,
  onError,
}: {
  org: OrgSummary;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const invites = useQuery({
    queryKey: ["org-invites", org.id],
    queryFn: () => listInvites(org.id),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["org-invites", org.id] });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>
          {/* ⚠️ The most load-bearing sentence on the page. An invitation into
              something called an organisation reads as an invitation to shared
              secrets, and it is not one. */}
          Joining decides which plan&apos;s limits apply to someone. It does{" "}
          <strong>not</strong> give them access to any vault.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <Button
            size="sm"
            disabled={busy || !email.includes("@")}
            onClick={async () => {
              onError(null);
              setBusy(true);
              try {
                const created = await sendInvite(org.id, email.trim(), role);
                setToken(created.token);
                setEmail("");
                refresh();
              } catch (e) {
                onError(apiMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Invite
          </Button>
        </div>

        {token && (
          <Alert>
            <AlertTitle>Invitation sent</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                An email is on its way. To pass it on yourself, this link works
                once and expires in seven days:
              </p>
              <code className="block break-all rounded bg-[var(--bg-overlay)] px-2 py-1 font-mono text-xs">
                {token}
              </code>
              <p className="text-xs">
                {/* ⚠️ Why showing it is safe. Redemption checks the invited
                    address against the redeemer's own account email, so a
                    forwarded link admits nobody else. */}
                Only the address you invited can redeem it — the link alone is not
                enough.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {invites.data && invites.data.length > 0 && (
          <div className="space-y-2">
            {invites.data.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    onError(null);
                    try {
                      await revokeInvite(org.id, i.id);
                      refresh();
                    } catch (e) {
                      onError(apiMessage(e));
                    }
                  }}
                >
                  Withdraw
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Create ───────────────────────────────────────────────────────────────────

function CreateOrg({ onDone, empty }: { onDone: () => void; empty?: boolean }) {
  const [open, setOpen] = useState(Boolean(empty));
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New organisation
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{empty ? "No organisations yet" : "New organisation"}</CardTitle>
        <CardDescription>
          You become the owner. {NOT_VAULT_ACCESS}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // A suggestion, not a lock — the field stays editable, and the
            // server's CHECK is the authority either way.
            if (!slug) {
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 63),
              );
            }
          }}
          placeholder="Acme Corp"
          className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="acme"
          className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits and hyphens. Used in links and on the command
          line.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !name.trim() || !slug.trim()}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await createOrg(name.trim(), slug.trim());
                setName("");
                setSlug("");
                if (!empty) setOpen(false);
                onDone();
              } catch (e) {
                setError(apiMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
          {!empty && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * ⚠️ This exists because leaving it out was a trap. Owning an organisation
 * blocks account deletion and the server caps creation at five, so with no way
 * to delete one, five organisations would permanently remove the ability to
 * close the account.
 */
function DangerZone({
  org,
  onError,
}: {
  org: OrgSummary;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const seated = org.seats.used > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete this organisation</CardTitle>
        <CardDescription>
          {seated
            ? `${org.seats.used} seat(s) are assigned. Every holder drops back to their own plan.`
            : "No seats are assigned, so nobody's limits change."}{" "}
          No vault is touched, and nothing anyone already pulled is recalled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                onError(null);
                setBusy(true);
                try {
                  // `force` only when it is actually needed, so the server's
                  // refusal still protects the case this UI has not anticipated.
                  await deleteOrg(org.id, seated);
                  qc.invalidateQueries({ queryKey: ["orgs"] });
                } catch (e) {
                  onError(apiMessage(e));
                } finally {
                  setBusy(false);
                  setConfirming(false);
                }
              }}
            >
              Delete {org.slug}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Delete organisation
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
