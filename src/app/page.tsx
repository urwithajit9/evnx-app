/**
 * The dashboard's front door.
 *
 * Not a marketing page — that is `evnx.dev`. Someone arriving here either has an
 * account or is about to make one, so the job is to get them to the right place
 * in one click and say enough about the trust model that the "cannot be reset"
 * warning on the next screen is not a surprise.
 *
 * A signed-in visitor is sent straight to their vaults. In practice that only
 * happens on a client-side navigation back to `/`, because a reload drops both
 * the tokens and the master key — but the check costs nothing and avoids showing
 * a "Sign in" button to someone who already is.
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useKeyStore } from "@/stores/keyStore";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();
  const unlocked = useKeyStore((s) => s.unlocked);

  useEffect(() => {
    if (unlocked) router.replace("/vaults/");
  }, [unlocked, router]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">
            ev
          </span>
          evnx
        </span>
        <a
          href="https://www.evnx.dev"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          evnx.dev
        </a>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg space-y-8">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Your encrypted <code className="font-mono">.env</code> files
            </h1>
            <p className="text-muted-foreground">
              Everything is encrypted in this browser before it is uploaded. The
              server stores ciphertext and nothing else — it cannot read your
              secrets with full database access, and neither can we.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login/">Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register/">Create an account</Link>
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-4 text-sm text-muted-foreground">
            <p>
              <strong className="font-medium text-foreground">
                Your master password cannot be reset.
              </strong>{" "}
              It never leaves your device, and the server holds nothing that
              could rebuild it. That is the point — and it means losing it loses
              the data.
            </p>
            <p>
              Already using the CLI? The same account works in both, and a file
              pushed from one comes out of the other byte for byte.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Prefer a terminal?{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              evnx cloud push .env
            </code>{" "}
            —{" "}
            <a
              href="https://www.evnx.dev/docs"
              className="underline underline-offset-4"
            >
              read the docs
            </a>
            .
          </p>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        Encrypted in this browser. The server only ever holds ciphertext.
      </footer>
    </div>
  );
}
