/**
 * A placeholder that holds the space the content will occupy.
 *
 * ⚠️ **The layout reservation is the point; the shimmer is decoration.** A bare
 * "Loading…" line does the opposite of this: the card is one line tall, then
 * suddenly six rows, and whatever the reader was about to click has moved.
 *
 * Rules, so they do not have to be decided again at each call site:
 *
 *   • A skeleton replaces *content*, never a whole card. The card, its title and
 *     its border stay — only the rows shimmer, so the page does not reflow twice.
 *   • Row count matches the last known count where there is one, three
 *     otherwise. A list that loaded six rows last time should not skeleton two.
 *   • `prefers-reduced-motion` turns the animation off, not the placeholder.
 */

import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-md bg-muted motion-safe:animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `count` skeleton rows at list proportions.
 *
 * ⚠️ `aria-busy` with a label rather than silence: a screen reader otherwise
 * reads an empty region and moves on, which is the same failure the visual
 * skeleton exists to prevent.
 */
export function SkeletonRows({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn("space-y-3", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="flex items-baseline justify-between gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Skeleton lines for a block that is not a list — a card body, a summary. */
export function SkeletonLines({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const widths = ["w-2/3", "w-1/2", "w-5/6", "w-3/5"];
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn("space-y-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", widths[i % widths.length])} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
