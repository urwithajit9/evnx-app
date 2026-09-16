/**
 * Progress for the Argon2id derivations.
 *
 * A login runs Argon2id twice and registration runs it twice as well — roughly
 * 300 ms of solid CPU on a desktop and several times that on a phone. It happens
 * in the Worker, so nothing freezes; what it looks like without feedback is a
 * button that did nothing.
 *
 * The copy says what is actually happening rather than "Loading…". The wait is
 * the product working — deliberately expensive key derivation is what makes a
 * stolen verifier hard to attack offline — so it is worth one honest sentence.
 *
 * ⚠️ The Phase 2 mockup captions this "Argon2id (~400ms intentional delay)".
 * Both halves of that are wrong: it is ~150 ms per derivation, measured, and it
 * is memory-hard work rather than a sleep. Do not reuse that wording.
 */

"use client";

import type { LoginProgress } from "@/lib/auth/login";
import type { RegisterProgress } from "@/lib/auth/register";

const LABELS: Record<LoginProgress | RegisterProgress, string> = {
  // Register
  "deriving-srp": "Deriving your sign-in proof…",
  "deriving-master-key": "Deriving your encryption key…",
  "generating-keypair": "Generating your keypair…",
  submitting: "Creating your account…",
  // Login
  starting: "Starting the handshake…",
  deriving: "Proving your password without sending it…",
  verifying: "Checking the server's proof…",
  "awaiting-second-factor": "Waiting for your second factor…",
  unlocking: "Unlocking your keys…",
};

export function DerivationStatus({
  stage,
}: {
  stage: LoginProgress | RegisterProgress | null;
}) {
  if (!stage) return null;
  return (
    <p
      className="flex items-center gap-2 text-sm text-muted-foreground"
      // Announce each stage, since the whole point is that something is
      // happening during a second of apparent stillness.
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
      />
      {LABELS[stage]}
    </p>
  );
}
