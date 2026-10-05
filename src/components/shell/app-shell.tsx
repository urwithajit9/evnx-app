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
 * ─── ⚠️ Navigation below 640px, which did not exist ──────────────────────────
 *
 * The only `<nav>` here was `hidden … sm:flex` with **nothing replacing it**, so
 * on a phone there was no clickable path to any page — including Settings, where
 * two-factor, session revocation, device disavowal and account deletion live.
 *
 * It was not a *lost route*: `/settings/` returned 200 and rendered, so anyone
 * typing the URL got there. It was undiscoverable, which is a different and
 * smaller bug — but on a security product the specific moment it bites is the
 * one that matters. The login alert now says "from a device we have not seen
 * before" and points at disavowal; people read email on phones, and that is
 * exactly when someone wants to revoke a session *now*.
 *
 * ⚠️ A `<details>` element rather than a React-state dropdown, deliberately:
 * it closes on outside click and on Escape, is keyboard- and
 * screen-reader-navigable, and needs no effect to tear down on route change.
 * The one thing it does not do by itself is close after a navigation, which is
 * why each link clears `open` on click.
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
import { useOnline } from "@/lib/online";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { DOCS, docsUrl } from "@/lib/config";

const NAV = [
  { href: "/vaults/", label: "Vaults" },
  { href: "/organizations/", label: "Organizations" },
  // ⚠️ Its own entry rather than a tab under Organizations, because
  // `evnx.dev/pricing` links straight to `/billing/?plan=…` — a destination
  // with no nav entry is one people cannot find their way back to.
  { href: "/billing/", label: "Billing" },
  // ⚠️ Last before Settings, and reachable without unlocking — it decrypts
  // nothing, and the person most likely to want it is the one who just
  // registered and has not installed the CLI yet.
  { href: "/tour/", label: "Commands" },
  { href: "/settings/", label: "Settings" },
];

/**
 * One banner, not five error cards.
 *
 * Offline, every query fails independently — the settings page alone can show
 * five cards each describing a network failure, none of which says the obvious
 * thing. This says it once, above the header, so it is read first and does not
 * compete with page content.
 *
 * ⚠️ **It must not promise the data is current.** "Showing what was already
 * loaded" is honest; "cached" invites the reading that something is keeping it
 * up to date.
 *
 * ⚠️ Actions that need the network stay visible and fail with their own message
 * rather than being hidden — a button that disappears reads as a bug, and the
 * person cannot tell whether the feature is gone or the connection is.
 */
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="border-b border-[var(--border-subtle)] bg-muted px-6 py-2 text-center text-sm"
    >
      <span className="font-medium">You are offline.</span>{" "}
      <span className="text-muted-foreground">
        Showing what was already loaded. Pushing, pulling and signing in need a
        connection.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <div className="flex min-h-svh flex-col">
      <OfflineBanner />
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
            <MobileNav pathname={pathname} />
            {/* Truncates rather than wraps — a long address must not change the
                header's height and shift every page below it. */}
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {user?.email}
            </span>
            <ThemeToggle />
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
            href={docsUrl(DOCS.cloudArchitecture)}
            className="underline-offset-4 hover:underline"
          >
            {/* ⚠️ Labelled for where it goes. This link sits beside a
                cryptographic claim and now points at the page that
                substantiates it; "Docs" would send the reader hunting. */}
            How this works
          </a>
        </div>
      </footer>
    </div>
  );
}

/**
 * The phone-width menu.
 *
 * ⚠️ `sm:hidden` so it is the exact complement of the desktop nav's `sm:flex` —
 * one or the other is always present, which is the property that was missing.
 */
function MobileNav({ pathname }: { pathname: string }) {
  return (
    <details className="relative sm:hidden" aria-label="Menu">
      <summary
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
        aria-label="Open menu"
      >
        {/* Inline SVG rather than an icon dependency — three lines do not
            justify pulling a package into the shell. */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 4.5h14M2 9h14M2 13.5h14" />
        </svg>
      </summary>

      <nav
        aria-label="Mobile"
        className="absolute right-0 z-50 mt-2 min-w-44 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] py-1 shadow-lg"
      >
        {NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              // ⚠️ Closes the disclosure on navigation. `<details>` has no idea
              // the route changed, so without this the menu stays open over the
              // page it just took you to.
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
              }}
              className={
                "block px-3 py-2 text-sm transition-colors " +
                (active
                  ? "bg-[var(--bg-overlay)] text-foreground"
                  : "text-muted-foreground hover:bg-[var(--bg-overlay)] hover:text-foreground")
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </details>
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
