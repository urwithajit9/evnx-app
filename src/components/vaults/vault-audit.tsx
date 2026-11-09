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
import { listAudit, listMembers } from "@/lib/api/vaults";
import { describeEvent, memberResolver, AuditEventText } from "@/lib/audit-events";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonLines } from "@/components/ui/skeleton";

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
  const nameOf = memberResolver(members.data);

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
              const { text, tone } = describeEvent(e, nameOf);
              return (
                <li key={e.id} className="flex flex-wrap gap-x-2 gap-y-0.5 py-2.5">
                  <AuditEventText event={e} text={text} tone={tone} />
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
