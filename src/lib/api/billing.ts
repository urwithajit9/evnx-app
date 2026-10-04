/**
 * Billing — Paddle.
 *
 * ─── ⛔ Nothing here can touch a secret ───────────────────────────────────────
 *
 * A subscription decides which **plan's limits** apply to an organisation's seat
 * holders. It cannot grant or revoke access to a vault, because the server has
 * never been able to wrap a vault key. A lapsed subscription changes quotas;
 * nothing is deleted for non-payment, and the server could not read it in order
 * to delete it even if someone wanted that.
 *
 * ⚠️ Every screen built on this module has to say so, because billing trouble on
 * a secrets product reads as losing access to secrets. It never is.
 *
 * ─── ⚠️ Checkout leaves this origin, and that is the point ───────────────────
 *
 * `startCheckout` returns a URL on **pay.evnx.dev**, not here. Paddle Billing has
 * no Paddle-hosted checkout page for the web, so Paddle.js has to run on a page
 * we own — and it must not be this one. This origin holds the master key in a Web
 * Worker and the access token in memory; a third-party script here could render a
 * convincing "re-enter your master password" prompt, which is a plaintext
 * compromise rather than a ciphertext one.
 *
 * ⚠️ Open it in a NEW TAB. Navigating away loses the master key, which lives
 * only in memory — the user would come back to a login screen having just paid.
 */

"use client";

import { api } from "./client";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

/** A cancellation (or pause) Paddle has accepted but not yet applied. */
export type ScheduledChange = {
  action: "cancel" | "pause" | "resume";
  effective_at: string;
};

export type BillingState = {
  plan: string;
  seats: { used: number; purchased: number | null };
  over_seated: boolean;
  your_role: "owner" | "admin" | "member";
  /** False on a self-hosted deployment with no Paddle account. */
  billing_configured: boolean;
  subscription: {
    exists: boolean;
    status: SubscriptionStatus | null;
    current_period_ends_at: string | null;
    /**
     * ⚠️ **Read this before trusting `status`.**
     *
     * Paddle does not set `canceled` when a customer cancels. The status stays
     * `active` and this appears instead. A screen that ignores it tells someone
     * who has just cancelled that their plan *renews* on the exact date it ends
     * — and the natural response to that is to cancel again through their bank.
     */
    scheduled_change: ScheduledChange | null;
  };
};

export type CatalogPrice = {
  price_id: string;
  plan: string;
  /** From Paddle, not from the env var's name. */
  interval: "month" | "year";
  /** ⚠️ A string in the lowest denomination — "900" is $9.00. Never a float. */
  amount: string;
  currency_code: string;
  max_quantity: number | null;
};

export type Invoice = {
  id: string;
  billed_at: string | null;
  status: string;
  currency_code: string;
  grand_total: string | null;
  quantity: number | null;
  invoice_url: string | null;
};

export type PortalUrls = {
  overview: string | null;
  view_subscription: string | null;
  cancel_subscription: string | null;
  update_payment_method: string | null;
};

export async function getBilling(orgId: string): Promise<BillingState> {
  const { data } = await api.get<BillingState>(`/orgs/${orgId}/billing`);
  return data;
}

/**
 * What can be bought, priced by Paddle rather than by us.
 *
 * ⚠️ The amounts are not constants anywhere in this codebase. A billing screen
 * showing a price different from the one charged is the worst bug on the worst
 * screen, and sandbox and live are entirely separate catalogues.
 */
export async function getCatalog(orgId: string): Promise<CatalogPrice[]> {
  const { data } = await api.get<{ prices: CatalogPrice[] }>(
    `/orgs/${orgId}/billing/catalog`,
  );
  return data.prices;
}

export async function getInvoices(orgId: string): Promise<Invoice[]> {
  const { data } = await api.get<{ invoices: Invoice[] }>(
    `/orgs/${orgId}/billing/invoices`,
  );
  return data.invoices;
}

/**
 * Start a checkout. Owner-only on the server.
 *
 * ⚠️ `org_id` is **not** sent — the server reads it from the session and writes
 * it into Paddle's `custom_data` where the browser cannot reach it. If the
 * browser chose, anyone could attach a subscription to an organisation they do
 * not own and the webhook would dutifully apply its plan.
 */
export async function startCheckout(
  orgId: string,
  priceId: string,
  quantity: number,
): Promise<{ checkout_url: string; transaction_id: string }> {
  const { data } = await api.post<{
    checkout_url: string;
    transaction_id: string;
  }>(`/orgs/${orgId}/checkout`, { price_id: priceId, quantity });
  return data;
}

/**
 * Change how many seats the subscription pays for.
 *
 * ⚠️ Deliberately **not** `setSeats` in `orgs.ts`. That one writes the column
 * directly, which is right with no Paddle and wrong with one — Paddle's quantity
 * is what the invoice is computed from. The server refuses the other route once
 * a subscription exists.
 *
 * ⚠️ The new count is not visible immediately. Paddle confirms by webhook, which
 * is usually a second and occasionally longer, so the caller must refetch rather
 * than assume.
 */
export async function changeSeats(
  orgId: string,
  quantity: number,
): Promise<void> {
  await api.post(`/orgs/${orgId}/billing/seats`, { quantity });
}

/**
 * Undo a scheduled cancellation.
 *
 * ⚠️ Not "restart a cancelled subscription". Once the status is actually
 * `canceled` there is nothing to resume and a new checkout is required.
 */
export async function resumeSubscription(orgId: string): Promise<void> {
  await api.post(`/orgs/${orgId}/billing/resume`);
}

/**
 * Authenticated deep links into Paddle's own customer portal.
 *
 * ⚠️ Cancellation, payment-method capture and receipts are Paddle's, not ours.
 * Paddle is the merchant of record — the seller on the customer's statement and
 * the party holding their card. Rebuilding those here would mean claiming
 * authority over a contract we are not party to, and putting a card form on an
 * origin that should never see one.
 *
 * The links expire quickly and are single-customer, so they are fetched on
 * demand and never cached.
 */
export async function getPortalUrls(orgId: string): Promise<PortalUrls> {
  const { data } = await api.post<{ urls: PortalUrls }>(
    `/orgs/${orgId}/billing/portal`,
  );
  return data.urls;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * `"900", "USD"` → `"$9.00"`.
 *
 * ⚠️ Paddle's amounts are integer strings in the currency's lowest denomination.
 * Dividing by 100 is wrong for zero-decimal currencies (JPY, KRW) and for
 * three-decimal ones (BHD, KWD), so the divisor comes from `Intl` rather than
 * from an assumption. evnx prices in USD today; the catalogue is Paddle's and
 * can change.
 */
export function formatMoney(amount: string, currency: string): string {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = Number(amount) / 10 ** digits;
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(value);
}

/** `"2026-11-03T…"` → `"3 November 2026"`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Which of the billing screen's states applies.
 *
 * ⚠️ One function, because the states are **not** mutually exclusive in the data
 * and reading `status` alone gets two of them wrong:
 *
 *   * `canceled` is not the same as a *scheduled* cancellation. The latter has
 *     `status: "active"`.
 *   * over-seated can be true in any of them, and is a warning rather than a
 *     state of its own — it never replaces what the screen otherwise says.
 *
 * Ordered by what the person most needs to know first: a payment that failed
 * outranks a cancellation that has not happened yet.
 */
export type BillingPhase =
  | "unconfigured"
  | "none"
  | "past_due"
  | "ending"
  | "paused"
  | "over"
  | "active";

export function billingPhase(s: BillingState): BillingPhase {
  if (!s.billing_configured) return "unconfigured";
  // ⚠️ `canceled` means the period has already run out, so there is nothing
  // left to manage and the honest screen is the one offering a new plan.
  if (!s.subscription.exists || s.subscription.status === "canceled") {
    return "none";
  }
  if (s.subscription.status === "past_due") return "past_due";
  if (s.subscription.scheduled_change?.action === "cancel") return "ending";
  if (s.subscription.status === "paused") return "paused";
  if (s.over_seated) return "over";
  return "active";
}
