/**
 * The trust vocabulary.
 *
 * ─── Why a zero-knowledge product needs this and most products do not ────────
 *
 * The guarantee is **invisible**. Nothing on screen looks different when the
 * encryption is working, so the interface has to say so — and if it says so five
 * slightly different ways, in five slightly different tones, it reads as
 * marketing rather than architecture.
 *
 * Two components, and the distinction between them is the point:
 *
 *   <ZeroKnowledge>  — a quiet, recurring statement of where the work happens.
 *   <Irreversible>   — a statement of FACT about the architecture.
 *
 * `Irreversible` deliberately does **not** use the warning colour. "Cannot be
 * reset", "shown once", "nobody can reissue these" are not cautions about risk
 * that a careful user might avoid — they are consequences of the design, true
 * however carefully anyone behaves. Dressing them as yellow alerts teaches people
 * to dismiss them, and these are the one category of message that must land.
 */

import type { ReactNode } from "react";

/**
 * "This happened in your browser." Used identically on the vault viewer, the
 * push form, registration and the TOTP secret — one colour, one icon, one voice.
 */
export function ZeroKnowledge({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <LockIcon />
      <span>{children}</span>
    </p>
  );
}

/**
 * A fact about the architecture, not a warning about behaviour.
 *
 * Rendered on the page's own ground with a brand-coloured rule rather than as a
 * filled alert — present and unmissable, but not styled like something that has
 * gone wrong, because nothing has.
 */
export function Irreversible({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-l-2 border-[var(--brand-500)] pl-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Inline, for a single value that was decrypted locally — a vault version, a
 * revealed secret. Sits next to a heading rather than in its own block.
 */
export function DecryptedHere({ label = "Decrypted in this browser" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--zk-accent)]">
      <LockIcon className="text-[var(--zk-accent)]" />
      {label}
    </span>
  );
}

/**
 * One padlock, everywhere. Inline SVG rather than an icon dependency so the
 * shape cannot drift between usages, and `aria-hidden` because every caller
 * already supplies the words.
 */
function LockIcon({ className = "text-[var(--zk-accent)]" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`mt-px size-3.5 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V4.75a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}
