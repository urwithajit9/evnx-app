/**
 * Turning an audit event into a sentence — shared by the vault page and the
 * activity dashboard, so the same event reads the same way in both.
 *
 * Moved out of `vault-audit.tsx` unchanged; the per-event reasoning below
 * (re-key reads, `removed_email`, unresolvable former members) is the original.
 */

import type { AuditEvent, VaultMember } from "@/lib/api/vaults";

/** A string field from untyped metadata, or undefined. */
function str(meta: Record<string, unknown> | null, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" ? v : undefined;
}

function num(meta: Record<string, unknown> | null, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === "number" ? v : undefined;
}

/** `1 version`, `3 versions` — "1 version(s)" reads like a placeholder. */
function plural(n: number | undefined, word: string): string {
  if (n === undefined) return `? ${word}s`;
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Turns a user id into something a person recognises. */
export type NameOf = (id: string | undefined) => string;

/**
 * Resolve a user id against the member list this page already holds.
 *
 * ⚠️ **The trail used to print `a332eb89` and stop there** — a uuid prefix, which
 * says nothing about who was granted access. The obvious fix is to have the server
 * write the email into `audit_events.metadata`, and that fix is **wrong**: migration
 * 006 makes the table append-only by trigger, so an email written there could never
 * be scrubbed — and account deletion would quietly stop being complete. Stored rows
 * hold ids only, and must keep doing so.
 *
 * So names are resolved on read. Most are resolved here, from data the page has
 * already fetched: no new endpoint, and in particular no `GET /users/:id → email`,
 * which is an id-to-email mapping and therefore an enumeration surface the moment
 * its authorisation is anything less than exact.
 *
 * ⓘ The one exception is `vault_rekey`: the removed member is no longer in the
 * member list, so the server looks up their email when the log is read and sends it
 * as `metadata.removed_email` (null once the account is gone). It is attached to the
 * response, never stored, which is what keeps the append-only rows free of it.
 *
 * ⚠️ A former member falls back to the short id, and that is the right answer rather
 * than a gap: they are gone, and the entry is recording that a grant happened, not
 * offering a way to contact them.
 */
export function memberResolver(members: VaultMember[] | undefined): NameOf {
  const byId = new Map((members ?? []).map((m) => [m.user_id, m.email]));
  return (id) => {
    if (!id) return "someone";
    return byId.get(id) ?? id.split("-")[0];
  };
}

/**
 * One line describing what happened.
 *
 * Unknown event types fall through to the raw type rather than being hidden: an
 * audit view that silently drops what it does not recognise is worse than one
 * that shows something ugly, because the thing it drops is exactly the thing
 * nobody anticipated.
 */
export function describeEvent(
  e: AuditEvent,
  nameOf: NameOf,
): { text: string; tone?: "notable" } {
  const m = e.metadata;
  switch (e.event_type) {
    case "push":
      return { text: `pushed version ${num(m, "version") ?? "?"}` };
    case "pull":
      // ⚠️ A re-key reads every version, so without this a rotation looks like
      // someone pulling the whole history one version at a time. The server marks
      // those reads, and an auditor needs to tell the two apart.
      return str(m, "purpose") === "rekey"
        ? { text: `re-key read v${num(m, "version") ?? "?"}` }
        : { text: `pulled version ${num(m, "version") ?? "?"}` };
    case "member_grant":
      return {
        text: `granted ${nameOf(str(m, "member_user_id"))} access as ${str(m, "role") ?? "a member"}`,
        tone: "notable",
      };
    case "member_role_change":
      return {
        text: `changed ${nameOf(str(m, "member_user_id"))} from ${str(m, "from") ?? "?"} to ${str(m, "to") ?? "?"}`,
        tone: "notable",
      };
    case "member_revoke": {
      const who = nameOf(str(m, "member_user_id"));
      const left = m?.voluntary === true;
      // ⚠️ Surfaced rather than buried. A removal without a re-key leaves the
      // old key in that person's hands, so they can still decrypt everything
      // they had — including versions pushed afterwards.
      const rekeyed = m?.rekeyed === true;
      return {
        text: left
          ? `${who} left the vault${rekeyed ? "" : " — the vault key was not rotated"}`
          : `removed ${who}${rekeyed ? "" : " without rotating the vault key"}`,
        tone: "notable",
      };
    }
    case "vault_rekey": {
      const removed = str(m, "removed_user_id");
      // The server now sends `removed_email` with the event (null once the
      // account is gone). Prefer it: the member list cannot name someone who has
      // already been removed, which is exactly who this entry is about. When it
      // is absent or null, fall back to the member-list lookup as before.
      const removedName = str(m, "removed_email") ?? (removed ? nameOf(removed) : undefined);
      return {
        text:
          `rotated the vault key — ${plural(num(m, "versions_rekeyed"), "version")} re-encrypted, ` +
          `${plural(num(m, "members_rewrapped"), "member")} re-wrapped` +
          (removedName ? `, removing ${removedName}` : ""),
        tone: "notable",
      };
    }
    case "token_create":
      return {
        text: `created an API token (${str(m, "scope") ?? "unknown scope"})`,
        tone: "notable",
      };
    default:
      return { text: e.event_type };
  }
}

/**
 * Resolve ids against the actors in a set of events.
 *
 * For views that span many vaults, where no single member list applies. An
 * event carries both `user_id` and `actor_email`, so anyone who has acted in
 * the loaded events can be named without a request; everyone else falls back
 * to the short id exactly as `memberResolver` does.
 */
export function eventActorResolver(events: AuditEvent[] | undefined): NameOf {
  const byId = new Map<string, string>();
  for (const e of events ?? []) {
    if (e.user_id && e.actor_email) byId.set(e.user_id, e.actor_email);
  }
  return (id) => {
    if (!id) return "someone";
    return byId.get(id) ?? id.split("-")[0];
  };
}

/** The "actor + sentence" half of a row; the caller adds time and any extras. */
export function AuditEventText({
  event,
  text,
  tone,
}: {
  event: AuditEvent;
  text: string;
  tone?: "notable";
}) {
  return (
    <span className="text-sm">
      <span
        className={
          tone === "notable"
            ? "font-medium text-foreground"
            : "text-muted-foreground"
        }
      >
        {/* A deleted account leaves its events behind with no
            actor — the FK nulls out and the event survives. */}
        {event.actor_email ?? "a deleted account"}
      </span>{" "}
      <span className="text-muted-foreground">{text}</span>
    </span>
  );
}
