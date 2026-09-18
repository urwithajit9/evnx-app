/**
 * The evnx mark: a rust-orange square with `ev`, beside the wordmark.
 *
 * One component because there were three copies — the landing page, the
 * signed-out layout and the app shell — and two of them had drifted to
 * `bg-foreground`, rendering a near-white square against evnx.dev's orange one.
 * A logo duplicated across files is a logo that will diverge again.
 *
 * Matches `evnx.dev`'s header exactly: `size-7`, brand ground, page-ground
 * lettering. Someone moving between the sites should not notice a seam.
 */

import Link from "next/link";

export function BrandMark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded bg-[var(--brand-500)] text-xs font-bold text-[var(--bg-base)]">
        ev
      </span>
      <span className="font-bold">evnx</span>
    </Link>
  );
}
