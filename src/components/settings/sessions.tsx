/**
 * Active sessions, and revoking them.
 *
 * The login-alert email points people here, so this is the page someone reaches
 * when they think their account has been used by somebody else. It should give
 * them one obvious action that ends every other session at once.
 *
 * Revocation is immediate, not eventual: the server kills the refresh tokens and
 * blocklists the session id in Valkey, so the access token dies now rather than
 * lingering for its remaining fifteen minutes. Worth saying on screen — "signed
 * out" that silently means "in fifteen minutes" is the opposite of reassuring.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type SessionSummary,
} from "@/lib/api/account";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Sessions() {
  const qc = useQueryClient();
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  async function act(key: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that session.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeCurrent() {
    // Revoking your own session is signing out, so do it through signOut —
    // which also zeroizes the keys in the Worker. Dropping the token while
    // leaving a master key behind would be a half-ended session.
    await signOut();
    router.push("/login/");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Every browser and CLI currently signed in. Revoking takes effect
          immediately — the access token is blocklisted, not left to expire.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {sessions.isPending && (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        )}
        {sessions.isError && (
          <Alert variant="destructive">
            <AlertDescription>Could not load your sessions.</AlertDescription>
          </Alert>
        )}

        {sessions.data && (
          <ul className="divide-y">
            {sessions.data.map((s) => (
              <SessionRow
                key={s.session_id}
                session={s}
                busy={busy === s.session_id}
                onRevoke={() =>
                  s.current
                    ? revokeCurrent()
                    : act(s.session_id, () => revokeSession(s.session_id))
                }
              />
            ))}
          </ul>
        )}

        {others > 0 && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => act("others", revokeOtherSessions)}
          >
            {busy === "others"
              ? "Revoking…"
              : `Sign out ${others} other session${others === 1 ? "" : "s"}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  busy,
  onRevoke,
}: {
  session: SessionSummary;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {session.current ? "This browser" : "Another device"}
          {session.current && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              current
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {/*
            No IP or user agent shown, because the server does not store them in
            a readable form — audit events keep a BLAKE3 hash of the IP and
            nothing else. A "last seen from Berlin" line would be invented.
          */}
          started {when(session.created_at)} · last used {when(session.last_used_at)}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={onRevoke}>
        {busy ? "Revoking…" : session.current ? "Sign out" : "Revoke"}
      </Button>
    </li>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
