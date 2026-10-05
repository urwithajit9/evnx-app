/**
 * The command tour.
 *
 * ⚠️ **Not behind the key store.** Every other signed-in page needs the master
 * key because it decrypts something; this one renders a static description of a
 * CLI and decrypts nothing. Gating it on `unlocked` would mean someone who just
 * registered — exactly the person who needs to learn the commands — is bounced
 * to a login screen to read documentation.
 *
 * It is still inside `AppShell`, so the nav is there and signing in is one
 * click away.
 */

"use client";

import { AppShell } from "@/components/shell/app-shell";
import { CommandTour } from "@/components/tour/command-tour";
import { EVNX_VERSION } from "@/lib/tour";

export default function TourPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="page-title text-xl font-semibold">Commands</h1>
          <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">
            Everything the evnx CLI can do, read from the binary itself rather
            than written out by hand — so a command that ships appears here, and
            one that is removed cannot linger.
          </p>
        </div>

        <CommandTour />

        <p className="text-xs text-muted-foreground">
          Generated from evnx <span className="font-mono">{EVNX_VERSION}</span>.
          Not installed yet?{" "}
          <a
            className="underline"
            href="https://docs.evnx.dev/cli/getting-started/installation"
            target="_blank"
            rel="noopener noreferrer"
          >
            Install evnx ↗
          </a>
        </p>
      </div>
    </AppShell>
  );
}
