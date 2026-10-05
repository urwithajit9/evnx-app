/**
 * Walk every reachable onboarding state and assert the rule holds.
 *
 * ⚠️ This exists because the checklist is the one piece of the app that cannot
 * be exercised without a signed-in account and a master password, so a browser
 * check covers the rendering and nothing of the logic. `deriveSteps` is pure,
 * so the logic can be checked exhaustively instead of anecdotally.
 *
 *   node scripts/check-onboarding.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// ⚠️ Transpiled with the `typescript` already in devDependencies, not a bundler
// added for this one script. And written INSIDE the project tree, not /tmp:
// the module imports `react` and `@tanstack/react-query` for real, so node's
// resolver has to be able to walk up to this package's `node_modules`.
const out = resolve("node_modules/.cache/evnx-check-onboarding.mjs");
mkdirSync(dirname(out), { recursive: true });

const src = readFileSync("src/lib/onboarding.ts", "utf8");
writeFileSync(
  out,
  ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      // `import type` is erased, which is what drops the `@/…` alias imports
      // node could not resolve anyway.
      verbatimModuleSyntax: false,
    },
  }).outputText,
);

const { deriveSteps, ONBOARDING_STEPS } = await import(pathToFileURL(out).href);

let failures = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failures++;
};

const vaults = {
  none: [],
  undef: undefined,
  empty: [{ version_count: 0 }],
  pushed: [{ version_count: 3 }],
  mixed: [{ version_count: 0 }, { version_count: 1 }],
};

let cases = 0;
for (const emailVerified of [false, true])
  for (const [vk, v] of Object.entries(vaults))
    for (const pulled of [false, true]) {
      cases++;
      const label = `verified=${emailVerified} vaults=${vk} pulled=${pulled}`;
      const { done, completed, current } = deriveSteps({
        emailVerified,
        vaults: v,
        pulled,
      });

      // 1 — `account` is unconditional: the card only renders for a session.
      if (!done.account) fail(`${label}: account should always be true`);

      // 2 — `completed` counts exactly the true flags.
      const n = ONBOARDING_STEPS.filter((s) => done[s]).length;
      if (completed !== n) fail(`${label}: completed=${completed}, expected ${n}`);

      // 3 — `current` is the FIRST incomplete step, and never a done one.
      const first = ONBOARDING_STEPS.find((s) => !done[s]) ?? null;
      if (current !== first) fail(`${label}: current=${current}, expected ${first}`);
      if (current !== null && done[current]) fail(`${label}: current is already done`);

      // 4 — all five done ⇒ current null, which is what hides the card.
      if (completed === ONBOARDING_STEPS.length && current !== null)
        fail(`${label}: all done but current=${current}`);
      if (completed < ONBOARDING_STEPS.length && current === null)
        fail(`${label}: ${completed}/5 done but nothing is current`);

      // 5 — `push` needs a vault with a version, not merely a vault.
      const anyVersion = (v ?? []).some((x) => x.version_count > 0);
      if (done.push !== anyVersion) fail(`${label}: push=${done.push}`);
      if (done.push && !done.vault) fail(`${label}: pushed without a vault`);
    }

// 6 — the two specific states the card renders differently, named explicitly
// so a regression reads as the screen it broke rather than a combination index.
const state1 = deriveSteps({ emailVerified: true, vaults: [], pulled: false });
if (state1.completed !== 2 || state1.current !== "vault")
  fail(`verified, no vault: expected 2/5 at "vault", got ${state1.completed}/5 at ${state1.current}`);

const state2 = deriveSteps({
  emailVerified: true,
  vaults: [{ version_count: 0 }],
  pulled: false,
});
if (state2.completed !== 3 || state2.current !== "push")
  fail(`vault, nothing pushed: expected 3/5 at "push", got ${state2.completed}/5 at ${state2.current}`);

const state3 = deriveSteps({
  emailVerified: true,
  vaults: [{ version_count: 1 }],
  pulled: false,
});
if (state3.completed !== 4 || state3.current !== "pull")
  fail(`pushed: expected 4/5 at "pull", got ${state3.completed}/5 at ${state3.current}`);

// 7 — non-contiguous progress: pushed and pulled from the CLI while the address
// is still unverified. `current` must be the earliest gap, not the latest.
const skew = deriveSteps({
  emailVerified: false,
  vaults: [{ version_count: 2 }],
  pulled: true,
});
if (skew.current !== "verified")
  fail(`unverified but pushed+pulled: current should be "verified", got ${skew.current}`);
if (skew.completed !== 4) fail(`unverified but pushed+pulled: expected 4/5, got ${skew.completed}`);

rmSync(out, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} assertion${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`✓ onboarding rule holds across ${cases} states and 4 named screens`);
