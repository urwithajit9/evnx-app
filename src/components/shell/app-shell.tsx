/**
 * Chrome for every signed-in page.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * `/vaults`, `/vaults/detail` and `/settings` each grew their own ad-hoc header
 * — a title, a back link, and a sign-out button arranged slightly differently on
 * each. That is how navigation drifts: nothing is wrong on any one page, and the
 * product still feels assembled rather than designed.
 *
 * The header deliberately mirrors `evnx.dev`'s: sticky, backdrop-blurred, 56px,
 * with the same brand square and wordmark. Someone moving between the marketing
 * site and the dashboard should not feel a seam.
 *
 * ─── The organisation slot ───────────────────────────────────────────────────
 *
 * `<OrgSlot />` renders nothing today. It is here because Phase 3 introduces
 * org/workspace scoping, and a switcher is persistent chrome that changes every
 * page's layout — retrofitting it later means touching every page again. The
 * space costs nothing to reserve and a great deal to add afterwards.
 */

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./brand-mark";

const NAV = [
  { href: "/vaults/", label: "Vaults" },
  { href: "/settings/", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark href="/vaults/" />

            <OrgSlot />

            <nav className="hidden items-center gap-1 sm:flex">
              {NAV.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={
                      "rounded-md px-2.5 py-1.5 text-sm transition-colors " +
                      (active
                        ? "bg-[var(--bg-overlay)] text-foreground"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {/* Truncates rather than wraps — a long address must not change the
                header's height and shift every page below it. */}
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {user?.email}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await signOut();
                router.push("/login/");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-[var(--border-subtle)] px-6 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Encrypted in this browser. The server only ever holds ciphertext.</span>
          <a
            href="https://www.evnx.dev/docs"
            className="underline-offset-4 hover:underline"
          >
            Docs
          </a>
        </div>
      </footer>
    </div>
  );
}

/**
 * Reserved for the Phase 3 organisation switcher.
 *
 * Renders nothing until organisations exist. Deliberately a component rather
 * than a comment, so the slot is in the layout tree and the header's spacing is
 * already correct when it starts rendering something.
 */
function OrgSlot() {
  return null;
}
