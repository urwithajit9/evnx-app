/**
 * Organisations.
 *
 * ⛔ An organisation is billing and a directory. It does not give anyone access
 * to a vault — see `components/orgs/organizations.tsx` for why that is
 * structural rather than a rule this screen enforces.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useKeyStore } from "@/stores/keyStore";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/shell/app-shell";
import { Organizations } from "@/components/orgs/organizations";

export default function OrganizationsPage() {
  const router = useRouter();
  const unlocked = useKeyStore((s) => s.unlocked);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!unlocked) router.replace("/login/");
  }, [unlocked, router]);

  if (!unlocked || !user) return null;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="page-title text-xl font-semibold">Organizations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Billing and a directory. A seat decides which plan&apos;s limits apply
            to its holder.{" "}
            {/* ⚠️ Seats are assigned here and *paid for* on /billing. Two
                screens for one number is confusing unless each points at the
                other, which is why this link is in the description and not
                buried in a menu. */}
            {/* ⚠️ `Link`, not `<a>`. A full page load discards the master
                key and drops the person on the login screen. */}
            <Link className="underline" href="/billing/">
              Plans and payment →
            </Link>
          </p>
        </div>

        <Organizations />
      </div>
    </AppShell>
  );
}
