/**
 * What has happened to this vault.
 *
 * ─── Why the rendering is per-event-type and not generic ─────────────────────
 *
 * A generic `{event_type}: {JSON.stringify(metadata)}` row would be quicker to
 * write and useless to read. An audit trail is scanned by a person looking for
 * something that surprises them, and `member_role_change {"from":"developer",
 * "to":"viewer","member_user_id":"…"}` does not surprise anyone because nobody
 * parses it. Each event says what it did in a sentence.
 *
 * ─── Why a viewer sees this ──────────────────────────────────────────────────
 *
 * Any member can read it. Noticing that someone pulled a secret they should not
 * have, or was granted access nobody expected, requires being able to look —
 * restricting the trail to admins blinds the people best placed to spot it.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  listAudit,
  listMembers,
  type AuditEvent,
  type VaultMember,
} from "@/lib/api/vaults";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonLines } from "@/components/ui/skeleton";

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
type NameOf = (id: string | undefined) => string;

/**
 * Resolve a user id against the member list this page already holds.
 *
 * ⚠️ **The trail used to print `a332eb89` and stop there** — a uuid prefix, which
 * says nothing about who was granted access. The obvious fix is to have the server
 * write the email into `audit_events.metadata`, and that fix is **wrong**: migration
 * 006 makes the table append-only by trigger, so an email written there could never
 * be scrubbed — and account deletion would quietly stop being complete.
 *
 * So it is resolved here, from data the page has already fetched. No new endpoint,
 * and in particular no `GET /users/:id → email`, which is an id-to-email mapping and
 * therefore an enumeration surface the moment its authorisation is anything less
 * than exact.
 *
 * ⚠️ A former member falls back to the short id, and that is the right answer rather
 * than a gap: they are gone, and the entry is recording that a grant happened, not
 * offering a way to contact them.
 */
function resolver(members: VaultMember[] | undefined): NameOf {
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
function describe(
  e: AuditEvent,
  nameOf: NameOf,
): { text: string; tone?: "notable" } {
  const m = e.metadata;
  switch (e.event_type) {
    case "push":
      return { text: `pushed version ${num(m, "version") ?? "?"}` };
    case "pull":
      return { text: `pulled version ${num(m, "version") ?? "?"}` };
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
      return {
        text:
          `rotated the vault key — ${plural(num(m, "versions_rekeyed"), "version")} re-encrypted, ` +
          `${plural(num(m, "members_rewrapped"), "member")} re-wrapped` +
          (removed ? `, removing ${nameOf(removed)}` : ""),
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

export function VaultAudit({ vaultId }: { vaultId: string }) {
  const events = useQuery({
    queryKey: ["audit", vaultId],
    queryFn: () => listAudit(vaultId),
  });

  // The same key the Members card uses, so this shares its cache rather than
  // issuing a second request for data already on the page.
  const members = useQuery({
    queryKey: ["members", vaultId],
    queryFn: () => listMembers(vaultId),
  });

  // ⚠️ Not gated on `members` having loaded. The trail renders with short ids and
  // fills in names when they arrive — waiting would hide the audit log behind a
  // second request, and the log is the more important of the two.
  const nameOf = resolver(members.data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Everything that has happened to this vault. Append-only — the server
          cannot edit or delete an entry once written, including on its own
          behalf.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {events.isPending && (
          <SkeletonLines count={4} />
        )}

        {events.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet.
          </p>
        )}

        {events.data && events.data.length > 0 && (
          <ul className="divide-y">
            {events.data.map((e) => {
              const { text, tone } = describe(e, nameOf);
              return (
                <li key={e.id} className="flex flex-wrap gap-x-2 gap-y-0.5 py-2.5">
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
                      {e.actor_email ?? "a deleted account"}
                    </span>{" "}
                    <span className="text-muted-foreground">{text}</span>
                  </span>
                  <time
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                    dateTime={e.created_at}
                    title={new Date(e.created_at).toLocaleString()}
                  >
                    {new Date(e.created_at).toLocaleString()}
                  </time>
                </li>
              );
            })}
          </ul>
        )}

        {events.data && events.data.length >= 200 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the most recent 200 events.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
