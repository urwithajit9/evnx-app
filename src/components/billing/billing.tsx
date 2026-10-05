/**
 * Billing.
 *
 * Built from `phase_2/C5-billing.html`, which was drawn before this screen
 * existed — unlike 3.2d, where no mockup existed and the one adjacent artefact
 * was wrong.
 *
 * ─── ⛔ The sentence every state repeats ─────────────────────────────────────
 *
 * Billing trouble on a secrets product reads as losing access to secrets. It
 * never is: a subscription decides which **plan's limits** apply, and the server
 * has never been able to wrap a vault key. Nothing is deleted for non-payment,
 * and the server could not read it in order to delete it. That is said on every
 * state that could worry someone, not once at the top.
 *
 * ─── ⚠️ Six states, three of them easy to forget entirely ────────────────────
 *
 * | state | why it is not obvious |
 * |---|---|
 * | **cancelled, still in period** | Paddle keeps `status: "active"` and attaches a `scheduled_change`. Reading `status` alone makes this screen say "renews" on the exact date the plan ends. |
 * | **over-seated** | A downgrade must never be refused, so more seats can be assigned than purchased. It is a warning laid over another state, never a state of its own. |
 * | **past due** | The limits have **not** changed yet. Saying otherwise makes people think they are already locked out. |
 *
 * ─── ⚠️ Checkout opens a new tab, deliberately ───────────────────────────────
 *
 * The master key lives in memory on this origin. Navigating away loses it, so
 * paying would end with the user back at a login screen. The link goes to
 * `pay.evnx.dev`, which is a separate origin precisely so that Paddle.js never
 * runs where the key does.
 */

"use client";

import { useState } from "react";
// ⚠️ `Link`, never a plain `<a href="/…">`, for anything inside this app.
//
// An `<a>` is a full page load, and a full page load discards the master key —
// it lives only in the crypto Worker's memory, so the person lands on the login
// screen having clicked a link that looked like navigation. Caught in a browser,
// not in review: the first version of this file used `<a>` in four places and
// every one of them signed the user out.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  billingPhase,
  changeSeats,
  formatDate,
  formatMoney,
  getBilling,
  getCatalog,
  getInvoices,
  getPortalUrls,
  resumeSubscription,
  startCheckout,
  type BillingState,
  type CatalogPrice,
} from "@/lib/api/billing";
import { listMembers, listOrgs, type OrgSummary } from "@/lib/api/orgs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadError } from "@/components/ui/load-error";
import { SkeletonLines } from "@/components/ui/skeleton";

/** Said on every state that could worry someone. */
const SECRETS_UNAFFECTED =
  "Your secrets are not affected, now or later. A subscription decides which plan's limits apply. It cannot lock you out of a vault, and nothing is ever deleted for non-payment — the server could not read it to delete it.";

/** Named on screen. Hiding the merchant of record causes chargebacks. */
const MERCHANT =
  "Payment is handled by Paddle, our merchant of record. evnx never sees your card.";

function apiMessage(e: unknown): string {
  const r = e as { response?: { data?: { error?: string } } };
  return r?.response?.data?.error ?? "Something went wrong. Nothing was changed.";
}

/** A status chip. */
function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "ok" | "warn" | "bad";
}) {
  const tones = {
    muted: "border-[var(--border-muted)] text-muted-foreground",
    ok: "border-[color-mix(in_oklch,var(--color-chart-2),transparent_60%)] text-[var(--color-chart-2)]",
    warn: "border-[color-mix(in_oklch,var(--color-chart-4),transparent_60%)] text-[var(--color-chart-4)]",
    bad: "border-destructive/40 text-destructive",
  } as const;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function Billing({ preselectPlan }: { preselectPlan?: string }) {
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: listOrgs });
  const [selected, setSelected] = useState<string | null>(null);

  // ⚠️ An organisation you *own* first. Billing is an owner's screen, and
  // landing a member on an organisation they cannot act on — when they own
  // another one they can — reads as the feature being broken.
  const current =
    orgs.data?.find((o) => o.id === selected) ??
    orgs.data?.find((o) => o.your_role === "owner") ??
    orgs.data?.[0] ??
    null;

  if (orgs.isLoading) {
    return <SkeletonLines count={3} />;
  }
  if (orgs.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load organisations</AlertTitle>
        <AlertDescription>{apiMessage(orgs.error)}</AlertDescription>
      </Alert>
    );
  }

  if (!orgs.data || orgs.data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No organisation yet</CardTitle>
          <CardDescription>
            A plan is bought by an organisation, not by an account — that is what
            makes a seat transferable between people.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/organizations/">Create an organisation</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {orgs.data.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {orgs.data.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o.id)}
              className={
                "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                (current?.id === o.id
                  ? "border-[var(--border-muted)] bg-[var(--bg-overlay)] text-foreground"
                  : "border-[var(--border-subtle)] text-muted-foreground hover:text-foreground")
              }
            >
              {o.slug}
            </button>
          ))}
        </div>
      )}
      {current && <OrgBilling org={current} preselectPlan={preselectPlan} />}
    </div>
  );
}

// ─── One organisation ─────────────────────────────────────────────────────────

function OrgBilling({
  org,
  preselectPlan,
}: {
  org: OrgSummary;
  preselectPlan?: string;
}) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["billing", org.id],
    queryFn: () => getBilling(org.id),
  });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["billing", org.id] });
    qc.invalidateQueries({ queryKey: ["orgs"] });
  };

  if (state.isLoading) {
    return <SkeletonLines count={3} />;
  }
  if (state.isError || !state.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load billing</AlertTitle>
        <AlertDescription>{apiMessage(state.error)}</AlertDescription>
      </Alert>
    );
  }

  const s = state.data;
  const phase = billingPhase(s);
  const isOwner = s.your_role === "owner";

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {org.name}
            <StatusPill state={s} />
          </CardTitle>
          <CardDescription>
            {org.slug} · {s.plan} plan · you are {s.your_role}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ⚠️ Only once something is paid for. Before that `seats` is NULL and
              the row reads "0 / unlimited", which is not true in any useful
              sense — a free organisation does not have unlimited seats, it has
              no seat count because seats are not what limits it. The plan
              chooser below has its own seat picker. */}
          {s.subscription.exists && <Seats state={s} />}

          {/* ⚠️ A warning laid over whatever else the screen says, never a
              state of its own — a downgrade can make this true while the
              subscription is perfectly healthy. */}
          {s.over_seated && <OverSeated state={s} />}

          {phase === "unconfigured" && (
            <p className="text-sm text-muted-foreground">
              This deployment has no payment provider configured, so plans are
              set by whoever runs it. Everything else works normally.
            </p>
          )}

          {phase === "past_due" && <PastDue org={org} onError={setError} />}
          {phase === "ending" && (
            <Ending org={org} state={s} onDone={refresh} onError={setError} />
          )}
          {phase === "paused" && (
            <p className="text-sm text-muted-foreground">
              This subscription is paused. {SECRETS_UNAFFECTED}
            </p>
          )}
          {(phase === "active" || phase === "over") && (
            <ActiveSubscription
              org={org}
              state={s}
              onDone={refresh}
              onError={setError}
            />
          )}

          {!isOwner && s.subscription.exists && <NotTheOwner org={org} />}
        </CardContent>
      </Card>

      {phase === "none" &&
        (isOwner ? (
          <ChoosePlan
            org={org}
            state={s}
            preselectPlan={preselectPlan}
            onError={setError}
          />
        ) : (
          <NotTheOwner org={org} />
        ))}

      {s.subscription.exists && <Invoices org={org} />}
    </div>
  );
}

function StatusPill({ state }: { state: BillingState }) {
  const phase = billingPhase(state);
  if (phase === "none") return <Pill>no subscription</Pill>;
  if (phase === "past_due") return <Pill tone="bad">payment failed</Pill>;
  if (phase === "ending") {
    return (
      <Pill tone="warn">
        ends {formatDate(state.subscription.scheduled_change?.effective_at)}
      </Pill>
    );
  }
  if (phase === "paused") return <Pill tone="warn">paused</Pill>;
  if (phase === "over") return <Pill tone="warn">over-seated</Pill>;
  if (phase === "unconfigured") return <Pill>self-hosted</Pill>;
  return <Pill tone="ok">active</Pill>;
}

/**
 * ⚠️ Assigned **and** purchased, never a single number. They diverge, and the
 * gap is the only thing anyone needs to act on.
 */
function Seats({ state }: { state: BillingState }) {
  const { used, purchased } = state.seats;
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] px-3 py-2">
      <span className="text-sm">Seats assigned</span>
      <span className="font-mono text-sm">
        {used} / {purchased ?? "unlimited"}
      </span>
    </div>
  );
}

function OverSeated({ state }: { state: BillingState }) {
  const over = state.seats.used - (state.seats.purchased ?? 0);
  return (
    <Alert>
      <AlertTitle>
        {over} seat{over === 1 ? "" : "s"} more than you are paying for
      </AlertTitle>
      <AlertDescription>
        Everyone keeps their seat and their limits — nothing has been taken away.
        Release {over === 1 ? "one" : `${over}`} from the{" "}
        <Link className="underline" href="/organizations/">
          members list
        </Link>
        , or raise the count.
        <br />
        <span className="text-muted-foreground">
          ⚠️ This is reported, never enforced. A billing downgrade must not be
          refused by us, or Paddle and our records end up disagreeing with no way
          to reconcile.
        </span>
      </AlertDescription>
    </Alert>
  );
}

// ─── 1 · No subscription ──────────────────────────────────────────────────────

function ChoosePlan({
  org,
  state,
  preselectPlan,
  onError,
}: {
  org: OrgSummary;
  state: BillingState;
  preselectPlan?: string;
  onError: (m: string | null) => void;
}) {
  const catalog = useQuery({
    queryKey: ["billing-catalog", org.id],
    queryFn: () => getCatalog(org.id),
  });
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [priceId, setPriceId] = useState<string | null>(null);
  // At least the seats already handed out, so the default never starts
  // over-seated.
  const [quantity, setQuantity] = useState(Math.max(1, state.seats.used));

  const checkout = useMutation({
    mutationFn: (id: string) => startCheckout(org.id, id, quantity),
    onError: (e) => onError(apiMessage(e)),
  });

  if (catalog.isLoading) {
    return <SkeletonLines count={4} />;
  }
  if (catalog.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load plans</AlertTitle>
        <AlertDescription>{apiMessage(catalog.error)}</AlertDescription>
      </Alert>
    );
  }

  // ⚠️ Sorted, because Paddle returns catalogue order — which put Enterprise
  // above Team on the first run. A plan list that does not ascend reads as
  // arbitrary, and the cheapest option being second is the one people miss.
  const prices = (catalog.data ?? [])
    .filter((p) => p.interval === interval)
    .sort((a, b) => Number(a.amount) - Number(b.amount));
  const chosen =
    prices.find((p) => p.price_id === priceId) ??
    prices.find((p) => p.plan === preselectPlan) ??
    prices.find((p) => p.plan === "team") ??
    prices[0] ??
    null;

  const total = chosen
    ? formatMoney(String(Number(chosen.amount) * quantity), chosen.currency_code)
    : "—";

  // ⚠️ Not `window.open` on the mutation's result. By the time the request
  // resolves the click gesture has expired, and Safari and Firefox block the
  // popup — so the button produces a URL and the person opens it. That also
  // means they see where they are going before they go, which on a payment
  // hand-off is the right order anyway.
  const url = checkout.data?.checkout_url;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a plan</CardTitle>
        <CardDescription>
          A seat decides which plan&apos;s limits apply to its holder. It does
          not grant access to any vault.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              onClick={() => {
                setInterval(i);
                setPriceId(null);
              }}
              className={
                "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                (interval === i
                  ? "border-[var(--border-muted)] bg-[var(--bg-overlay)] text-foreground"
                  : "border-[var(--border-subtle)] text-muted-foreground hover:text-foreground")
              }
            >
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {prices.map((p) => (
            <PlanCard
              key={p.price_id}
              price={p}
              selected={chosen?.price_id === p.price_id}
              current={p.plan === state.plan}
              onSelect={() => setPriceId(p.price_id)}
            />
          ))}
        </div>

        <div className="space-y-2 rounded-md border border-[var(--border-subtle)] p-3">
          <p className="text-sm">
            Seats — how many people get these limits.
          </p>
          <p className="text-xs text-muted-foreground">
            You can change it any time; Paddle prorates.
          </p>
          <SeatStepper
            value={quantity}
            min={1}
            max={chosen?.max_quantity ?? 999_999}
            onChange={setQuantity}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2">
          <span className="text-sm">
            {chosen ? `${chosen.plan} · ${quantity} seat${quantity === 1 ? "" : "s"} · ${interval === "month" ? "monthly" : "yearly"}` : "—"}
          </span>
          <span className="font-mono text-sm">
            {total} / {interval}
          </span>
        </div>

        {url ? (
          <div className="space-y-2">
            {/* ⚠️ `target="_blank"` and `rel="noopener"`: this origin holds the
                master key in memory, and navigating away loses it — the person
                would come back from paying to a login screen. */}
            <Button asChild className="w-full">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open secure payment page ↗
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens Paddle in a new tab, so this one keeps your session. Come
              back here when you are done — the plan updates by itself.
            </p>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={!chosen || checkout.isPending}
            onClick={() => chosen && checkout.mutate(chosen.price_id)}
          >
            {checkout.isPending ? "Preparing…" : "Continue to payment"}
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          {MERCHANT}{" "}
          {/* ⚠️ Linked rather than duplicated. What each plan allows is a
              commercial contract maintained in `@evnx/config`'s plan-limits and
              enforced by the server's Quotas; a second copy on this screen is a
              second copy to drift. */}
          <a
            className="underline"
            href="https://www.evnx.dev/pricing"
            target="_blank"
            rel="noopener noreferrer"
          >
            Compare what each plan includes ↗
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

function PlanCard({
  price,
  selected,
  current,
  onSelect,
}: {
  price: CatalogPrice;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "rounded-lg border p-3 text-left transition-colors " +
        (selected
          ? "border-primary bg-[var(--bg-overlay)]"
          : "border-[var(--border-subtle)] hover:border-[var(--border-muted)]")
      }
    >
      <div className="flex items-center gap-2 text-sm font-medium capitalize">
        {price.plan}
        {current && <Pill>current</Pill>}
      </div>
      <div className="mt-1 font-mono text-sm">
        {formatMoney(price.amount, price.currency_code)}
        <span className="text-muted-foreground">
          {" "}
          / seat / {price.interval}
        </span>
      </div>
    </button>
  );
}

function SeatStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="One fewer seat"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </Button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        aria-label="Seats"
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        className="h-8 w-20 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 text-center font-mono text-sm"
      />
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="One more seat"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </Button>
    </div>
  );
}

// ─── 2 · Active ───────────────────────────────────────────────────────────────

function ActiveSubscription({
  org,
  state,
  onDone,
  onError,
}: {
  org: OrgSummary;
  state: BillingState;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const isOwner = state.your_role === "owner";
  const [seats, setSeats] = useState(state.seats.purchased ?? 1);
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () => changeSeats(org.id, seats),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError: (e) => onError(apiMessage(e)),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Renews {formatDate(state.subscription.current_period_ends_at)}.
      </p>

      {isOwner && (
        <div className="space-y-3">
          {editing ? (
            <div className="space-y-2 rounded-md border border-[var(--border-subtle)] p-3">
              <p className="text-sm">How many seats should be paid for?</p>
              <SeatStepper
                value={seats}
                min={1}
                max={999_999}
                onChange={setSeats}
              />
              {/* ⚠️ Said before the change, not after. Lowering below what is
                  assigned is allowed — the server will not refuse a downgrade —
                  and nobody is kicked out by it. */}
              {seats < state.seats.used && (
                <p className="text-xs text-muted-foreground">
                  ⚠️ {state.seats.used} seats are assigned. Nobody loses one
                  automatically; the organisation will simply show as
                  over-seated until someone is released.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Asking Paddle…" : "Confirm"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSeats(state.seats.purchased ?? 1);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paddle prorates the difference and confirms in a moment — the
                number above updates when it does.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Change seats
              </Button>
              <PortalButtons org={org} onError={onError} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Links into Paddle's own portal.
 *
 * ⚠️ Fetched on click, never on render. The links are authenticated,
 * short-lived and single-customer — Paddle's documentation says not to cache
 * them — and fetching them on render would mint one for every page view.
 */
function PortalButtons({
  org,
  onError,
  only,
}: {
  org: OrgSummary;
  onError: (m: string | null) => void;
  only?: "update_payment_method" | "cancel_subscription";
}) {
  const portal = useMutation({
    mutationFn: () => getPortalUrls(org.id),
    onError: (e) => onError(apiMessage(e)),
  });
  const urls = portal.data;

  if (!urls) {
    return (
      <Button
        size="sm"
        variant={only ? "default" : "outline"}
        disabled={portal.isPending}
        onClick={() => portal.mutate()}
      >
        {portal.isPending
          ? "Opening Paddle…"
          : only === "update_payment_method"
            ? "Update payment method"
            : "Manage payment & cancellation"}
      </Button>
    );
  }

  const link = (href: string | null, label: string) =>
    href ? (
      <Button size="sm" variant="outline" asChild>
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label} ↗
        </a>
      </Button>
    ) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {only === "update_payment_method"
        ? link(urls.update_payment_method, "Update payment method")
        : (
          <>
            {link(urls.update_payment_method, "Update payment method")}
            {link(urls.cancel_subscription, "Cancel subscription")}
            {link(urls.view_subscription, "Manage in Paddle")}
          </>
        )}
      <span className="text-xs text-muted-foreground">
        Opens Paddle in a new tab. These links expire shortly.
      </span>
    </div>
  );
}

// ─── 4 · Past due ─────────────────────────────────────────────────────────────

function PastDue({
  org,
  onError,
}: {
  org: OrgSummary;
  onError: (m: string | null) => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>A payment did not go through</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Paddle will try again on its own schedule.{" "}
          <strong>Your limits have not changed yet.</strong>
        </p>
        <PortalButtons org={org} onError={onError} only="update_payment_method" />
        <p className="text-muted-foreground">⛔ {SECRETS_UNAFFECTED}</p>
      </AlertDescription>
    </Alert>
  );
}

// ─── 5 · Cancelled, still in period ───────────────────────────────────────────

/**
 * ⚠️ The state everyone forgets. "Cancelled" reads as over; it is not, and the
 * difference is a month of service someone has already paid for.
 */
function Ending({
  org,
  state,
  onDone,
  onError,
}: {
  org: OrgSummary;
  state: BillingState;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const ends = state.subscription.scheduled_change?.effective_at ?? null;
  const resume = useMutation({
    mutationFn: () => resumeSubscription(org.id),
    onSuccess: onDone,
    onError: (e) => onError(apiMessage(e)),
  });

  return (
    <Alert>
      <AlertTitle>This plan ends on {formatDate(ends)}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          It is still fully active until then. On that date everyone holding a
          seat drops to Free — 3 vaults each, 5 versions, 2 API tokens.
        </p>
        <p>
          {state.seats.used} {state.seats.used === 1 ? "person holds" : "people hold"}{" "}
          a seat today. Nothing is deleted. A vault over the new limit stays
          readable; the next push to it is refused.
        </p>
        {state.your_role === "owner" && (
          <Button
            size="sm"
            disabled={resume.isPending}
            onClick={() => resume.mutate()}
          >
            {resume.isPending ? "Asking Paddle…" : "Resume subscription"}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// ─── 6 · Not the owner ────────────────────────────────────────────────────────

/**
 * ⚠️ A sentence naming who to ask, not a row of disabled buttons. A greyed
 * control looks broken; this says what is true.
 */
function NotTheOwner({ org }: { org: OrgSummary }) {
  const members = useQuery({
    queryKey: ["org-members", org.id],
    queryFn: () => listMembers(org.id),
  });
  const owner = members.data?.find((m) => m.role === "owner");

  return (
    <Alert>
      <AlertTitle>Only the owner can change billing</AlertTitle>
      <AlertDescription>
        The plan, the seat count and the payment method are what the invoice is
        computed from.{" "}
        {owner ? <strong>{owner.email}</strong> : "The owner"} owns this
        organisation.
        <br />
        You can still assign and release seats from the{" "}
        <Link className="underline" href="/organizations/">
          members list
        </Link>
        .
      </AlertDescription>
    </Alert>
  );
}

// ─── 7 · Invoices ─────────────────────────────────────────────────────────────

function Invoices({ org }: { org: OrgSummary }) {
  const invoices = useQuery({
    queryKey: ["billing-invoices", org.id],
    queryFn: () => getInvoices(org.id),
  });

  // ⚠️ Loading and genuinely-empty both stay silent, and that is right: an org
  // with no invoices should not be shown an empty "Invoices" card, and a card
  // that appears mid-load would make the page jump for everyone.
  //
  // **A failure is different.** Someone who has paid and cannot see their
  // receipts was being told nothing at all, which reads as "evnx has no record
  // of your payments" — the worst available reading of a failed GET.
  if (invoices.isLoading) return null;
  if (invoices.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadError
            title="Could not load your invoices"
            reassurance="Your payments and your plan are unaffected — this is the list failing to load. Paddle also emails every receipt."
            onRetry={() => invoices.refetch()}
            retrying={invoices.isRefetching}
          />
        </CardContent>
      </Card>
    );
  }
  const rows = invoices.data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          Receipts come from Paddle, the merchant of record — they are the seller
          on your statement and they hold the billing details. This list links
          out rather than reproducing them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">Date</th>
                <th className="py-1.5 pr-3 font-normal">Seats</th>
                <th className="py-1.5 pr-3 font-normal">Status</th>
                <th className="py-1.5 pr-3 text-right font-normal">Amount</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                  <td className="py-2 pr-3">{formatDate(r.billed_at)}</td>
                  <td className="py-2 pr-3">{r.quantity ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <Pill tone={r.status === "completed" ? "ok" : "warn"}>
                      {r.status}
                    </Pill>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {r.grand_total
                      ? formatMoney(r.grand_total, r.currency_code)
                      : "—"}
                  </td>
                  <td className="py-2">
                    {r.invoice_url && (
                      <a
                        className="underline"
                        href={r.invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Receipt ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
