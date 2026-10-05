/**
 * The first-run checklist on `/vaults/`.
 *
 * ─── What it is for ─────────────────────────────────────────────────────────
 *
 * Getting someone from "account created" to "a secret came back on another
 * machine". That last step is the product; everything before it is setup.
 *
 * ─── Rules it follows, and why each one is a rule ───────────────────────────
 *
 * **It replaces the empty state, never stacks on it.** Two "you have no vaults,
 * here is how" blocks on one page is worse than either alone.
 *
 * **It leaves and stays gone.** Once the last step is done or dismissed it does
 * not come back — not for a second vault, not on another device once the flag
 * is set. It is onboarding, not a dashboard.
 *
 * **It is dismissible at every step.** A checklist that cannot be closed is a
 * nag, and someone who pulled on a CI runner they will never log into has
 * genuinely finished in a way the app cannot see.
 *
 * ⚠️ **No gamification.** No confetti, no badge, no "🎉 You're all set". The
 * people installing a zero-knowledge secrets vault are the people most
 * irritated by it, and this card earns its place by being short and then
 * leaving.
 *
 * ⚠️ **No upgrade CTA here.** Billing is live in sandbox only, and inviting a
 * brand-new account to pay would send them to a checkout that takes test cards.
 * See `lib/config/billing.ts`.
 *
 * ─── One create affordance, not two ─────────────────────────────────────────
 *
 * The mockup drew a "New vault" button inside step 3. The real page already has
 * `<CreateVault>` directly above, so this step points at it instead of growing
 * a second button that opens the same form. Likewise step 4 links to the vault
 * where `<PushVersion>` already lives rather than reimplementing a file picker
 * inside a checklist.
 */

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { docsUrl, DOCS } from "@/lib/config";
import {
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding";
import type { VaultSummary } from "@/lib/api/vaults";

const TITLE: Record<OnboardingStep, string> = {
  account: "Account created",
  verified: "Email verified",
  vault: "Create a vault",
  push: "Push your first .env",
  pull: "Pull it somewhere else",
};

export function OnboardingChecklist({
  state,
  vaults,
  email,
}: {
  state: OnboardingState;
  vaults: VaultSummary[] | undefined;
  email: string;
}) {
  if (!state.visible) return null;

  // Step 4 and 5 name a real vault where there is one. A checklist that says
  // `my-app/production` when the person called theirs something else reads as
  // documentation rather than as their account.
  const first = vaults?.[0];
  const target = first ? `${first.name}/${first.environment}` : "my-app";

  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle as="h2">Get your first secret synced</CardTitle>
        <span className="text-sm text-muted-foreground tabular-nums">
          {state.completed} of {ONBOARDING_STEPS.length}
        </span>
      </CardHeader>
      <CardContent className="space-y-1">
        <ol className="space-y-1">
          {ONBOARDING_STEPS.map((step) => (
            <li key={step} className="flex gap-3 py-1">
              {/* ⚠️ A transparent ✓ holding the column open is invisible on
                  screen but still real text — it lands in innerText, in a
                  find-on-page, and in anything reading the DOM. An empty box of
                  the same width is the same layout and says nothing. */}
              <span aria-hidden className="w-3 shrink-0 text-sm leading-6 text-muted-foreground">
                {state.done[step] ? "✓" : ""}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={
                    state.done[step]
                      ? "text-sm text-muted-foreground line-through decoration-muted-foreground/40"
                      : "text-sm font-medium"
                  }
                >
                  <span className="sr-only">
                    {state.done[step] ? "Done: " : "To do: "}
                  </span>
                  {TITLE[step]}
                </p>
                {state.current === step && (
                  <StepDetail
                    step={step}
                    target={target}
                    vaultId={first?.id}
                    email={email}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2 pt-3">
          {state.current === "pull" && (
            <Button size="sm" variant="outline" onClick={state.finish}>
              I&apos;ve done this
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={state.finish}
            className="text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Shell({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
      <code>{children}</code>
    </pre>
  );
}

function StepDetail({
  step,
  target,
  vaultId,
  email,
}: {
  step: OnboardingStep;
  target: string;
  vaultId: string | undefined;
  email: string;
}) {
  const note = "mt-1 text-sm text-muted-foreground";

  switch (step) {
    // `account` is never current — rendering the card proves it.
    case "account":
      return null;

    case "verified":
      return (
        <div>
          <p className={note}>
            Vault routes stay closed until {email} is confirmed, so the steps
            below will be refused until then.{" "}
            <Link href="/verify-email/" className="underline underline-offset-4">
              Resend the email
            </Link>
            .
          </p>
        </div>
      );

    case "vault":
      return (
        <div>
          <p className={note}>
            A vault holds one <code className="font-mono">.env</code> and its
            history. Most people start with one per environment. Use{" "}
            <strong className="font-medium text-foreground">New vault</strong>{" "}
            below, or the CLI — either can read the other&apos;s.
          </p>
          <Shell>{"evnx vault create my-app --env production"}</Shell>
        </div>
      );

    case "push":
      return (
        <div>
          <p className={note}>
            It is encrypted on this device before it leaves. The server receives
            ciphertext and the variable <em>names</em> — never a value.
          </p>
          {vaultId && (
            <p className={note}>
              <Link
                href={`/vaults/detail/?id=${encodeURIComponent(vaultId)}`}
                className="underline underline-offset-4"
              >
                Open {target}
              </Link>{" "}
              to push from the browser, or:
            </p>
          )}
          <Shell>
            {`evnx auth login\nevnx cloud push .env --vault ${target}`}
          </Shell>
          <p className={note}>
            Your master password never leaves this device, and neither does the
            key derived from it.{" "}
            <a
              href={docsUrl(DOCS.quickStart)}
              className="underline underline-offset-4"
            >
              Install the CLI
            </a>
            .
          </p>
        </div>
      );

    case "pull":
      return (
        <div>
          <p className={note}>
            This is the part worth seeing. On another machine, or in CI, the same
            file comes back — byte for byte, comments and all.
          </p>
          <Shell>
            {`evnx cloud pull --vault ${target}\n\n# or skip the file entirely, which is the point:\nevnx cloud run --vault ${target} -- ./deploy.sh`}
          </Shell>
          <p className={note}>
            Done it on a machine you will not sign in from? Say so below — a
            pull on a CI runner is still a pull, and this page cannot see it.
          </p>
        </div>
      );
  }
}
