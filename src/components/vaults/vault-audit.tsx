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
import { listAudit, type AuditEvent } from "@/lib/api/vaults";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

/** A short handle for a uuid — enough to match against the member list. */
function shortId(id: string | undefined): string {
  return id ? id.split("-")[0] : "someone";
}

/**
 * One line describing what happened.
 *
 * Unknown event types fall through to the raw type rather than being hidden: an
 * audit view that silently drops what it does not recognise is worse than one
 * that shows something ugly, because the thing it drops is exactly the thing
 * nobody anticipated.
 */
function describe(e: AuditEvent): { text: string; tone?: "notable" } {
  const m = e.metadata;
  switch (e.event_type) {
    case "push":
      return { text: `pushed version ${num(m, "version") ?? "?"}` };
    case "pull":
      return { text: `pulled version ${num(m, "version") ?? "?"}` };
    case "member_grant":
      return {
        text: `granted ${shortId(str(m, "member_user_id"))} access as ${str(m, "role") ?? "a member"}`,
        tone: "notable",
      };
    case "member_role_change":
      return {
        text: `changed ${shortId(str(m, "member_user_id"))} from ${str(m, "from") ?? "?"} to ${str(m, "to") ?? "?"}`,
        tone: "notable",
      };
    case "member_revoke": {
      const who = shortId(str(m, "member_user_id"));
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
          (removed ? `, removing ${shortId(removed)}` : ""),
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
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        )}

        {events.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet.
          </p>
        )}

        {events.data && events.data.length > 0 && (
          <ul className="divide-y">
            {events.data.map((e) => {
              const { text, tone } = describe(e);
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
