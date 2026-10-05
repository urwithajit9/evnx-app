/**
 * The one switch that waits on Paddle going live.
 *
 * ─── ⚠️ WHAT THIS DOES NOT GATE ─────────────────────────────────────────────
 *
 * It does **not** hide `/billing/`, and it must not start to. That page is
 * already deployed, already in the nav, and already proven end to end against
 * Paddle's sandbox — a real $18.00 purchase, a real cancellation, and the
 * `scheduled_change` screen that came out of it. Hiding a working page behind a
 * flag would mean the flag's `false` branch is the untested one, which is the
 * wrong way round: the branch that ships first is the branch that gets
 * exercised.
 *
 * It also does not decide whether real money moves. **That is decided entirely
 * by the server's `PADDLE_ENVIRONMENT`**, which is `sandbox`. A client flag
 * cannot charge anyone, and must never be described as if it could.
 *
 * ─── What it does gate ──────────────────────────────────────────────────────
 *
 * Exactly one thing: whether a *first-time* user is invited to pay. An upgrade
 * CTA shown to someone who then reaches a sandbox checkout has been lied to, so
 * while this is `false` the app states the free limit and the remedy within it
 * ("delete one to free a slot") and offers no upsell.
 *
 * ─── Flipping it ────────────────────────────────────────────────────────────
 *
 *   NEXT_PUBLIC_BILLING_LIVE=true     on the Cloudflare Pages project for
 *                                     app.evnx.dev, then redeploy.
 *
 * ⚠️ **It has a twin, and they are NOT the same switch.** evnx-web has
 * `BILLING_LIVE` in `packages/config/src/plans.ts`, set on the **Vercel**
 * project that builds `apps/web` — it moves the pricing page's Upgrade button
 * from `/register/` to `/billing/`. Two origins, two hosts, two env vars.
 * Setting one does nothing to the other, and `evnx-web` is on Vercel while this
 * app is on Cloudflare Pages — a mistake this project has already made once in
 * its own notes.
 *
 * ⚠️ **Flip web first.** It owns the entry point: a marketing page sending
 * people to `/billing/` before this app offers an upgrade path is a dead end,
 * whereas this app offering one before marketing links to it is merely early.
 *
 * Order, for whoever does it: web → confirm → app.
 */

/**
 * Whether Paddle is live and the app may invite someone to pay.
 *
 * ⚠️ Compared against the string `"true"`, not coerced. `NEXT_PUBLIC_*` values
 * arrive as strings, and `Boolean("false")` is `true` — which would turn an
 * explicit *off* into an on.
 */
export const BILLING_LIVE = process.env.NEXT_PUBLIC_BILLING_LIVE === "true";

/** Where an upgrade CTA points, or `null` when there should not be one. */
export function upgradeHref(): string | null {
  return BILLING_LIVE ? "/billing/" : null;
}
