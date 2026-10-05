/**
 * A list with nothing in it.
 *
 * An empty state answers two questions: **did this work?** and **what now?**
 * An empty card answers neither — it is indistinguishable from a card that is
 * still loading and from one that failed.
 *
 * ⚠️ **When the honest answer to "what now" is "nothing", say so rather than
 * inventing an action.** The sessions list with one session is the case: you are
 * signed in here and nowhere else, and there is nothing to do about that. A
 * button there would be worse than no button.
 */

import type { ReactNode } from "react";

export function EmptyState({
  glyph = "◦",
  title,
  children,
  action,
}: {
  /** A single character. ⚠️ Decorative and `aria-hidden` — it carries no meaning
   *  a screen reader needs, and announcing "white bullet" helps nobody. */
  glyph?: string;
  title: string;
  /** One sentence: what this list will hold once it holds something. */
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-2">
      <span aria-hidden className="shrink-0 text-muted-foreground">
        {glyph}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
