/**
 * Organisations — billing and a directory.
 *
 * ─── ⛔ What an organisation is not ──────────────────────────────────────────
 *
 * It does **not** grant access to a vault. It owns a plan and a set of seats; a
 * seat decides which plan's limits apply to its holder. The server cannot wrap a
 * vault key — that is evnx's central guarantee, not a gap in it — so no
 * membership, role or seat can produce vault access. Sharing is a separate,
 * deliberate act by someone who holds the key.
 *
 * ⚠️ **This is the single most tempting thing to get wrong in this UI**, and the
 * nearest existing mockup gets it wrong: `phase_3/01-member-management.html`
 * puts a seat meter under "Manage vault access and roles across your
 * organization". Seats and vault access are different axes. Nothing in this
 * module or its components should imply otherwise.
 *
 * ─── Every route here is session-only ───────────────────────────────────────
 *
 * The server puts them all behind `require_user_session`, so an `evnx_tok_` API
 * token is refused with 403. A browser session is always the right kind of
 * credential, so the UI never has to make that distinction — same as
 * `account.ts`.
 */

"use client";

import { api } from "./client";

export type Seats = {
  used: number;
  /** `null` is unlimited. */
  purchased: number | null;
};

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  your_role: "owner" | "admin" | "member";
  /** ⚠️ Whether **you** hold a seat here — not whether any seat is free. */
  you_hold_a_seat: boolean;
  seats: Seats;
};

export type OrgMember = {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  holds_a_seat: boolean;
  seat_assigned_at: string | null;
  joined_at: string;
  is_you: boolean;
};

export type OrgInvite = {
  id: string;
  email: string;
  role: "admin" | "member";
  expires_at: string;
  created_at: string;
};

export type CreatedInvite = {
  id: string;
  email: string;
  role: string;
  /**
   * Shown **once**, like a new API token.
   *
   * ⚠️ Safe to display only because redemption checks the invited address
   * against the redeemer's own account email. Without that, the token alone
   * would admit anyone it was forwarded to.
   */
  token: string;
  expires_in_days: number;
};

export type AcceptedInvite = {
  org_id: string;
  organization: string;
  role: string;
  /** Always false — joining assigns no seat; an administrator does that. */
  seat: boolean;
  note: string;
};

export async function listOrgs(): Promise<OrgSummary[]> {
  const { data } = await api.get<{ organizations: OrgSummary[] }>("/orgs");
  return data.organizations;
}

export async function createOrg(name: string, slug: string): Promise<OrgSummary> {
  const { data } = await api.post<OrgSummary>("/orgs", { name, slug });
  return data;
}

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const { data } = await api.get<{ members: OrgMember[] }>(
    `/orgs/${orgId}/members`,
  );
  return data.members;
}

export async function listInvites(orgId: string): Promise<OrgInvite[]> {
  const { data } = await api.get<{ invites: OrgInvite[] }>(
    `/orgs/${orgId}/invites`,
  );
  return data.invites;
}

export async function invite(
  orgId: string,
  email: string,
  role: "member" | "admin",
): Promise<CreatedInvite> {
  const { data } = await api.post<CreatedInvite>(`/orgs/${orgId}/invites`, {
    email,
    role,
  });
  return data;
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
  await api.delete(`/orgs/${orgId}/invites/${inviteId}`);
}

/**
 * Redeem an invitation.
 *
 * ⚠️ A wrong token, an expired one, a spent one and one addressed to someone
 * else all answer **identically** (422 with one message). That is deliberate on
 * the server — distinguishing them would turn the endpoint into an oracle for
 * which invitations exist — so the UI must not try to guess which happened.
 */
export async function acceptInvite(token: string): Promise<AcceptedInvite> {
  const { data } = await api.post<AcceptedInvite>("/orgs/invites/accept", {
    token: token.trim(),
  });
  return data;
}

/** Rename. Administration, not billing. */
export async function renameOrg(orgId: string, name: string): Promise<void> {
  await api.patch(`/orgs/${orgId}`, { name });
}

/**
 * Set the purchased seat count. **Owner-only** on the server.
 *
 * ⚠️ Lowering it below what is already assigned is allowed and only reported —
 * the server refuses to refuse, so that a billing downgrade can never be
 * rejected by the database. The response says `over_seated` when that happens
 * and the UI has to surface it, because the people over the line keep their
 * seats until one is released.
 */
export async function setSeats(
  orgId: string,
  seats: number | null,
): Promise<{ seats: Seats; over_seated: boolean }> {
  const { data } = await api.put<{ seats: Seats; over_seated: boolean }>(
    `/orgs/${orgId}/seats`,
    { seats },
  );
  return data;
}

/**
 * Assign or release a seat.
 *
 * ⚠️ **This is a plan change for the person named.** Assigning moves their
 * limits to this organisation's plan; releasing drops them back to their own.
 * Nothing is deleted either way — a vault already over the new limit stays
 * readable, and the next push to it is what gets refused.
 */
export async function setSeat(
  orgId: string,
  userId: string,
  seat: boolean,
): Promise<void> {
  await api.patch(`/orgs/${orgId}/members/${userId}`, { seat });
}

/** Change someone's role. `owner` is not grantable. */
export async function setRole(
  orgId: string,
  userId: string,
  role: "member" | "admin",
): Promise<void> {
  await api.patch(`/orgs/${orgId}/members/${userId}`, { role });
}

/** Remove someone, or — when `userId` is your own — leave. */
export async function removeMember(orgId: string, userId: string): Promise<void> {
  await api.delete(`/orgs/${orgId}/members/${userId}`);
}

/**
 * Delete an organisation. Owner-only.
 *
 * ⚠️ `force` is needed while seats are assigned, because deleting drops every
 * holder back to their own plan and they are not the one doing it.
 *
 * This is also the release valve for account deletion, which the server refuses
 * while you own an organisation.
 */
export async function deleteOrg(orgId: string, force: boolean): Promise<void> {
  await api.delete(`/orgs/${orgId}`, { data: { force } });
}

/** `2 / 5`, or `2 / unlimited`. */
export function renderSeats(s: Seats): string {
  return `${s.used} / ${s.purchased ?? "unlimited"}`;
}

/** Whether more seats are assigned than purchased — reported, never refused. */
export function isOverSeated(s: Seats): boolean {
  return s.purchased !== null && s.used > s.purchased;
}
