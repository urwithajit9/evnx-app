#!/usr/bin/env node
// ─── Refresh src/data/command-surface.json from the evnx binary ───────────────
//
//   node scripts/sync-command-surface.mjs           rewrite the file
//   node scripts/sync-command-surface.mjs --check   exit 1 if it is stale (CI)
//
// ⚠️ WHY THIS EXISTS RATHER THAN A HAND-WRITTEN LIST
//
// Five documentation errors of one shape have been found by hand in this
// project, and hand sweeps do not repeat:
//
//   * `evnx vault rekey` documented before it existed
//   * `commands/auth` missing four subcommands for a whole release
//   * `cloud delete-version` shipping with no row in its own table
//   * `EVNX_COMMANDS` in evnx-web omitting `spec` entirely
//   * PyPI shipping five releases with no cloud commands, unnoticed
//
// Every one is "a second list of what the CLI does, maintained by hand". So the
// tour does not keep one. `evnx surface` walks clap's own command tree — the
// same structure that parses the arguments — and this writes it down.
//
// ⚠️ THE RULE: A FAILED RUN NEVER OVERWRITES GOOD DATA.
//
// The same rule evnx-web's sync-config.mjs enforces, for the same reason. The
// obvious implementation (write whatever came back) turns one missing binary
// into a tour with zero commands, shipped, silently.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "data", "command-surface.json");

const checkOnly = process.argv.includes("--check");

// ⚠️ --all-features, and it is not optional.
//
// `cloud`, `migrate` and `backup` are optional features, so a `default = []`
// binary emits 18 commands instead of 80 and no `auth`, `vault`, `cloud` or
// `org` at all. A tour generated from that would quietly lose every cloud
// command — which is the whole reason anybody is logged into this app.
const HINTS = [
  join(HERE, "..", "..", "evnx", "target", "release", "evnx"),
  join(HERE, "..", "..", "evnx", "target", "debug", "evnx"),
];

function findBinary() {
  // ⚠️ EVNX_BIN is an OVERRIDE, not a hint. If it is set and missing, that is
  // an error — the first version of this treated it as one candidate among
  // several, so a typo'd path silently fell through to whatever was in
  // ../evnx/target/release, which is a different binary with a different
  // feature set. Reading from the wrong binary is the one failure this whole
  // script exists to prevent.
  if (process.env.EVNX_BIN) {
    if (!existsSync(process.env.EVNX_BIN)) {
      throw new Error(`EVNX_BIN is set to ${process.env.EVNX_BIN}, which does not exist`);
    }
    return process.env.EVNX_BIN;
  }
  for (const p of HINTS) if (existsSync(p)) return p;
  return null;
}

function emit(bin) {
  const raw = execFileSync(bin, ["surface", "--compact"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const data = JSON.parse(raw);

  // ⚠️ Refuse a default-features build rather than writing a surface that is
  // missing two thirds of the commands. This is the single most likely way to
  // get a wrong-but-plausible file.
  if (!data.features?.includes("cloud")) {
    throw new Error(
      `${bin} was built without the \`cloud\` feature, so its surface has no ` +
        `auth/vault/cloud/org commands. Rebuild with:\n` +
        `    cargo build --release --all-features\n` +
        `features seen: ${JSON.stringify(data.features ?? [])}`,
    );
  }

  // ⚠️ The emitter versions its own shape. A tour built against schema 1 and fed
  // a schema 2 payload is exactly the drift this file prevents, one layer up.
  if (data.schema !== 1) {
    throw new Error(
      `evnx surface emitted schema ${data.schema}; this script understands 1. ` +
        `Update src/lib/tour.ts and this check together.`,
    );
  }

  if (!Array.isArray(data.commands) || data.commands.length < 20) {
    throw new Error(
      `surface looks wrong: ${data.commands?.length ?? 0} commands. Expected 80+.`,
    );
  }
  return data;
}

let bin;
try {
  bin = findBinary();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (!bin) {
  const msg =
    "no evnx binary found. Set EVNX_BIN, or build one:\n" +
    "    cd ../evnx && cargo build --release --all-features";
  if (checkOnly) {
    // ⚠️ Not a failure. CI for this app must not break because a sibling Rust
    // repo is absent — that would make the app unbuildable by anyone who only
    // cloned the app. The check is advisory; the committed file is the source
    // of truth for the build.
    console.log(`skipped: ${msg}`);
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
}

let data;
try {
  data = emit(bin);
} catch (e) {
  console.error(`could not read the command surface from ${bin}:\n${e.message}`);
  // The existing file is left exactly as it was. See the rule at the top.
  process.exit(1);
}

const next = JSON.stringify(data, null, 2) + "\n";
const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

if (checkOnly) {
  if (next === current) {
    console.log(
      `✓ command-surface.json matches ${bin} ` +
        `(${data.commands.length} commands, evnx ${data.evnx_version})`,
    );
    process.exit(0);
  }
  console.error(
    "✗ command-surface.json is stale.\n" +
      "  Run: node scripts/sync-command-surface.mjs\n" +
      `  Binary: ${bin} (evnx ${data.evnx_version}, ${data.commands.length} commands)`,
  );
  process.exit(1);
}

writeFileSync(OUT, next);
console.log(
  `wrote ${OUT}\n  evnx ${data.evnx_version} · ${data.commands.length} commands · ` +
    `features: ${data.features.join(", ")}`,
);
