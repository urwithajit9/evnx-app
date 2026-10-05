/**
 * Onboarding progress — derived, never stored.
 *
 * ─── The problem ────────────────────────────────────────────────────────────
 *
 * Register → verify → sign in → create a vault are four pages that each work
 * and never mention each other. Someone who finishes all four lands on a list
 * with one empty vault in it and no next step, having protected nothing. The
 * value of evnx is not a vault; it is a secret that moved between two machines
 * without ever being readable in between, and nothing walked anyone there.
 *
 * ─── Why derived and not a table ────────────────────────────────────────────
 *
 * Every step below is a boolean read off a call `/vaults/` already makes. That
 * buys three things beyond saving an endpoint:
 *
 *   • It is correct on a new device immediately — no migration, no per-user row.
 *   • It cannot disagree with reality. Stored progress eventually will.
 *   • Deleting a vault walks it backwards, which is the truth.
 *
 * ⚠️ **No new endpoint, or this is the wrong design.** A step that needs a
 * server change belongs somewhere else.
 *
 * ─── ⚠️ Two external stores, and no `useEffect` ─────────────────────────────
 *
 * Both the dismissal flag and the audit cache are state React does not own, so
 * both are read with `useSyncExternalStore` rather than copied into `useState`
 * from an effect. That is not a lint workaround — a copy is a second source of
 * truth that goes stale, and here it would go stale in the two ways that
 * matter: a dismissal in another tab, and an audit trail arriving a moment
 * after this card first drew.
 *
 * ─── The one flag that is stored ────────────────────────────────────────────
 *
 * Dismissal, in `localStorage`, scoped to the account. **"I've done this" and
 * "Dismiss" write the same flag** — deliberately, because the rule is that once
 * the last step is done *or* dismissed the card never returns, so the two have
 * one end state and one flag rather than two that can disagree.
 */

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AuditEvent, VaultSummary } from "@/lib/api/vaults";

export type OnboardingStep = "account" | "verified" | "vault" | "push" | "pull";

/**
 * The five steps, in the order they happen.
 *
 * ⚠️ `/verify-email/` prints "Step 2 of 5" and takes the 5 from here being
 * five. Changing this list means changing that string.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  "account",
  "verified",
  "vault",
  "push",
  "pull",
];

export type OnboardingState = {
  done: Record<OnboardingStep, boolean>;
  /** How many of the five are complete. */
  completed: number;
  /** The first incomplete step, or `null` when all five are done. */
  current: OnboardingStep | null;
  /** Whether the card should render at all. */
  visible: boolean;
  /** Hide it for good — both the explicit dismissal and "I've done this". */
  finish: () => void;
};

// ─── Store 1: the dismissal flag ─────────────────────────────────────────────

function storageKey(userId: string): string {
  return `evnx.onboarding.done.${userId}`;
}

/**
 * ⚠️ Every access is wrapped. `localStorage` is not merely empty in a private
 * window or with site data blocked — the accessor itself throws. An onboarding
 * card is not worth a blank page.
 */
function readFinished(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

/** Same-tab writes do not fire `storage`, so subscribers are notified by hand. */
const listeners = new Set<() => void>();

function subscribeFinished(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeFinished(userId: string) {
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    // A browser that will not remember the dismissal shows the card again next
    // visit. Mildly annoying; not worth failing the render over.
  }
  listeners.forEach((fn) => fn());
}

// ─── Store 2: the audit cache ────────────────────────────────────────────────

/**
 * Has anyone pulled from any vault?
 *
 * ⚠️ **Reads the query cache and never fetches.** `pull` is a real audit event
 * (`evnx-server/src/routes/versions.rs:211`), but it lands on a vault this page
 * is not showing, so noticing it eagerly would cost one request per vault on
 * every visit — to decorate a checklist.
 *
 * ⚠️ **So this signal is session-scoped, and that is not hidden from the user.**
 * It fires when the audit trail happens to already be loaded, because the
 * person opened a vault in this page session. After a reload the cache is cold
 * and the step reads as incomplete again — which is honest, because the app
 * genuinely does not know. The button is the reliable path and is always there;
 * this just saves a click for the people it can.
 */
function pulledFromCache(client: QueryClient): boolean {
  return client
    .getQueriesData({ queryKey: ["audit"] })
    .some(([, data]) =>
      Array.isArray(data)
        ? (data as AuditEvent[]).some((e) => e?.event_type === "pull")
        : false,
    );
}

/**
 * The whole of the progress rule, as a pure function.
 *
 * Separated from the hook on purpose: this is the part that can be wrong in a
 * way nobody notices — an off-by-one in `completed`, or `current` picking a
 * step that is already done — and a pure function is the only version of it
 * that can be checked without a browser and a signed-in account.
 * `scripts/check-onboarding.mjs` walks every reachable combination.
 */
export function deriveSteps(input: {
  emailVerified: boolean;
  vaults: VaultSummary[] | undefined;
  pulled: boolean;
}): {
  done: Record<OnboardingStep, boolean>;
  completed: number;
  current: OnboardingStep | null;
} {
  const done: Record<OnboardingStep, boolean> = {
    // Rendering at all means a session exists and the key store is unlocked.
    account: true,
    verified: input.emailVerified,
    vault: (input.vaults?.length ?? 0) > 0,
    push: (input.vaults ?? []).some((v) => v.version_count > 0),
    pull: input.pulled,
  };
  return {
    done,
    completed: ONBOARDING_STEPS.filter((s) => done[s]).length,
    // ⚠️ The FIRST incomplete step, not the last complete one plus one. They
    // differ whenever progress is non-contiguous, which is reachable: pushing
    // from the CLI and pulling on a CI runner sets `push` and `pull` while an
    // unverified address leaves `verified` false. The earliest gap is the one
    // actually blocking them.
    current: ONBOARDING_STEPS.find((s) => !done[s]) ?? null,
  };
}

export function useOnboarding(input: {
  userId: string;
  emailVerified: boolean;
  vaults: VaultSummary[] | undefined;
  /** False while the vault list is still loading — avoids a flash of "step 3". */
  ready: boolean;
}): OnboardingState {
  const { userId, emailVerified, vaults, ready } = input;
  const queryClient = useQueryClient();

  const finished = useSyncExternalStore(
    subscribeFinished,
    () => readFinished(userId),
    // ⚠️ `true` during prerender. A static export cannot read `localStorage`
    // while building, and defaulting a nag to *shown* would flash it at
    // everyone who has already dismissed it. Hidden until proven otherwise.
    () => true,
  );

  const pulled = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
      [queryClient],
    ),
    () => pulledFromCache(queryClient),
    () => false,
  );

  const finish = useCallback(() => writeFinished(userId), [userId]);

  const { done, completed, current } = deriveSteps({
    emailVerified,
    vaults,
    pulled,
  });

  return {
    done,
    completed,
    current,
    // All five true hides it without writing anything: `current` is null, so
    // there is nothing left to prompt. It is onboarding, not a dashboard.
    visible: ready && !finished && current !== null,
    finish,
  };
}
