/**
 * The evnx mark — the interlocked shield, padlock and orange key — beside the
 * wordmark.
 *
 * One component because there were three copies — the landing page, the
 * signed-out layout and the app shell — and two of them had drifted apart. A logo
 * duplicated across files is a logo that will diverge again.
 *
 * ⚠️ The SIMPLE mark, without "EVNX" lettered inside the shield: the logo spec
 * says that text cannot be read below 48 px and this sits at 28. The word is set
 * beside it in the page's own font instead, as evnx.dev's header does. It is the
 * same file evnx.dev serves (`/brand/evnx-mark-simple.svg`), so someone moving
 * between the sites should not notice a seam.
 *
 * Decorative (`alt=""`): it always sits next to the word "evnx", which is the
 * link's accessible name. A plain `<img>` rather than `next/image` — an SVG needs
 * no optimisation, and the static export has no image optimiser to run it.
 */

import Link from "next/link";

/** The mark's viewBox is 140 × 172. */
const SIZE = 28;

export function BrandMark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/evnx-mark-simple.svg"
        alt=""
        width={Math.round((SIZE * 140) / 172)}
        height={SIZE}
        className="shrink-0"
      />
      <span className="font-bold">evnx</span>
    </Link>
  );
}
