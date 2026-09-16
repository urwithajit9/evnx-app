/**
 * Layout for the signed-out pages: register, sign-in, email verification.
 *
 * A route group — `(auth)` never appears in a URL, so these stay at `/register`,
 * `/login` and `/verify-email`.
 */

import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">
            ev
          </span>
          evnx
        </Link>
        <a
          href="https://www.evnx.dev/docs"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Docs
        </a>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        Encrypted in this browser. The server only ever holds ciphertext.
      </footer>
    </div>
  );
}
