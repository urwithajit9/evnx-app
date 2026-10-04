/**
 * Open-redirect self-test for the login page's `?next=`.
 *
 * ─── Why this is worth a page ───────────────────────────────────────────────
 *
 * `?next=` was added so an invitation link survives a sign-in: the email sends
 * someone to `/organizations/accept/?token=…`, they are not signed in, and
 * without it the token is lost behind a hardcoded redirect to `/vaults/`.
 *
 * ⚠️ **That parameter is an open redirect by default.**
 * `?next=https://evil.example/login` would turn evnx's own login page into a
 * credential-phishing hop reached from a genuine evnx link. The guard is four
 * lines and entirely invisible on inspection — which is exactly the kind of
 * thing that gets "simplified" away by someone who cannot see what it is for.
 *
 * This app has no test runner; it has self-test pages. So the guard gets one.
 * Open `/selftest/redirect/`.
 */

"use client";

import { useState } from "react";
import { safeNext } from "@/app/(auth)/login/page";

type Case = { input: string | null; want: string; why: string };

const CASES: Case[] = [
  { input: null, want: "/vaults/", why: "no parameter at all" },
  { input: "", want: "/vaults/", why: "empty" },
  {
    input: "/organizations/accept/?token=abc",
    want: "/organizations/accept/?token=abc",
    why: "the case this exists for — an invitation surviving a sign-in",
  },
  { input: "/vaults/detail/?id=1", want: "/vaults/detail/?id=1", why: "ordinary in-app path" },
  {
    input: "https://evil.example/login",
    want: "/vaults/",
    why: "absolute URL — the phishing hop",
  },
  {
    input: "//evil.example",
    want: "/vaults/",
    why: "protocol-relative; browsers treat it as cross-origin",
  },
  {
    input: "/\\evil.example",
    want: "/vaults/",
    why: "backslash — some parsers normalise it to a second slash",
  },
  { input: "javascript:alert(1)", want: "/vaults/", why: "scheme, not a path" },
  { input: "vaults/", want: "/vaults/", why: "relative — no leading slash" },
];

export default function RedirectSelfTest() {
  const [rows] = useState(() =>
    CASES.map((c) => {
      const got = safeNext(c.input);
      return { ...c, got, ok: got === c.want };
    }),
  );
  const failed = rows.filter((r) => !r.ok).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="page-title text-xl font-semibold">
        Login redirect self-test
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every input that is not a same-origin absolute path must fall back to{" "}
        <code>/vaults/</code>.
      </p>

      <p className={"mt-4 text-sm " + (failed ? "text-red-500" : "text-green-600")}>
        {failed === 0
          ? `All ${rows.length} cases refused or allowed correctly.`
          : `${failed} of ${rows.length} FAILED — do not ship.`}
      </p>

      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 font-medium">input</th>
            <th className="py-2 pr-4 font-medium">result</th>
            <th className="py-2 font-medium">why it matters</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--border-subtle)]">
              <td className="py-2 pr-4 break-all">{JSON.stringify(r.input)}</td>
              <td className="py-2 pr-4 break-all">
                <span className={r.ok ? "text-green-600" : "text-red-500"}>
                  {r.ok ? "✓" : "✗"}
                </span>{" "}
                {r.got}
              </td>
              <td className="py-2 font-sans text-muted-foreground">{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
