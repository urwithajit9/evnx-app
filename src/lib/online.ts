/**
 * Whether the app can currently reach the server.
 *
 * ─── ⚠️ The source of truth is TanStack's `onlineManager`, not `navigator` ───
 *
 * This matters more than it sounds. `onlineManager` is what actually decides
 * whether queries run: with the default `networkMode: "online"`, a query it
 * believes to be offline is **paused**, not failed. Its `fetchStatus` becomes
 * `"paused"` while `status` stays `"pending"` — so `isError` never becomes true,
 * no error branch ever renders, and the card shows a loading skeleton forever.
 *
 * That was observed, not theorised: with `/auth/usage` returning 500, the plan
 * card sat at `{status: "pending", fetchStatus: "paused", failureCount: 1}`
 * indefinitely while `navigator.onLine` reported `true`. A banner keyed on
 * `navigator` alone would have stayed hidden through all of it, which is the
 * worst case — an eternal skeleton and nothing saying why.
 *
 * So the banner follows the thing that stopped the request.
 *
 * ─── The other two signals ──────────────────────────────────────────────────
 *
 *   • `navigator.onLine` going false — immediate, and right most of the time.
 *     ⚠️ Going *true* proves nothing: it reports a network interface, not
 *     reachability, so a captive portal reports `true`.
 *   • **A request failing with no response at all.** Axios surfaces that as an
 *     error with no `response`, which is the difference between "the server
 *     said no" and "nothing answered". A 500 is the server working.
 */

"use client";

import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

let unreachable = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

/**
 * A request failed with no response at all — nothing answered.
 *
 * ⚠️ This also tells `onlineManager`, so queries pause instead of burning
 * retries against a server that is not there, and so the banner and the query
 * layer cannot disagree about whether we are connected.
 */
export function noteUnreachable() {
  onlineManager.setOnline(false);
  if (unreachable) return;
  unreachable = true;
  emit();
}

/** A request came back. Whatever was in the way is not any more. */
export function noteReachable() {
  onlineManager.setOnline(true);
  if (!unreachable) return;
  unreachable = false;
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  const unsubscribeManager = onlineManager.subscribe(onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    unsubscribeManager();
  };
}

function snapshot(): boolean {
  // `navigator.onLine` false is conclusive; true is merely not-disproven.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  // Whatever paused the queries is what the reader needs explaining.
  if (!onlineManager.isOnline()) return false;
  return !unreachable;
}

/**
 * `true` when the app has no reason to think it is cut off.
 *
 * ⚠️ Optimistic during prerender. A static export renders this on a build
 * machine, and an offline banner baked into the HTML would be shown to everyone
 * for the first paint.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
