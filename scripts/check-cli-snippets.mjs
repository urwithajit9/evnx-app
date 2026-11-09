#!/usr/bin/env node
// ─── Every `evnx …` command this app shows the user is one the CLI accepts ────
//
//   node scripts/check-cli-snippets.mjs
//
// ⚠️ WHY THIS EXISTS: 0.13.0 rejects `evnx cloud push .env --vault x` with
// "unexpected argument '.env'" — and the app showed exactly that in four places.
// Nothing failed in the app; the user found out by pasting it into a terminal.
// `surface:check` guards the tour's JSON, but not the hand-written snippets.
//
// Reads the COMMITTED src/data/command-surface.json, never a binary, so it runs
// in CI (where there is no binary). Freshness of that file is surface:check's job.
//
// ⚠️ WHAT COUNTS AS AN INVOCATION. Prose says "evnx never sees your card" and
// "evnx is…" all over the UI, so a scan for the word finds noise, and a check
// that cries wolf gets turned off. An `evnx` is treated as the start of a
// command only when it opens something code-shaped:
//
//   * directly after a quote, backtick or literal `\n`  ("evnx init", `…\nevnx x`)
//   * directly after a <code>/<pre>/<kbd>/<Shell> tag
//   * at the start of a source line (JSX text on its own line)
//
// and, for a first word that is not a command at all, only when the snippet is
// closed by a quote/tag (so it was a whole string) rather than running to the end
// of a wrapped line of prose. Mid-sentence mentions are never checked.
//
// ⚠️ NOT COVERED: a command assembled from pieces at runtime, and commands in
// .json/.md. `{expr}` / `${expr}` / `<name>` / `&lt;name&gt;` are placeholders:
// they stand in for one value and are not guessed at.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const surface = JSON.parse(
  readFileSync(join(ROOT, "src", "data", "command-surface.json"), "utf8"),
);

// ─── Index the surface ───────────────────────────────────────────────────────
// children: "cloud" → Map(name-or-alias → command). Aliases register under the
// same parent, so `evnx cloud ls` resolves like `evnx cloud list`.
const key = (path) => path.join(" ");
const children = new Map();
const byKey = new Map();
for (const c of surface.commands) {
  byKey.set(key(c.path), c);
  const parent = key(c.path.slice(0, -1));
  if (!children.has(parent)) children.set(parent, new Map());
  for (const n of [c.name, ...(c.aliases ?? []), ...(c.visible_aliases ?? [])]) {
    children.get(parent).set(n, c);
  }
}

// ⚠️ Global flags (--server, --verbose, …) are emitted on every command's own
// `args` by `evnx surface`, so they need no special casing. Help and version are
// clap built-ins and are not in the surface at all.
const BUILTIN_LONG = new Set(["help", "version"]);
const BUILTIN_SHORT = new Set(["h", "V"]);

function argsOf(cmd) {
  return cmd.args.filter((a) => !a.hidden || a.long || a.short);
}

// ─── Find candidate invocations in a source file ─────────────────────────────

const CODE_TAGS = /<(?:code|pre|kbd|Shell|samp)\b[^<>]*>\s*$/;

/** Candidates: { line, text, closed } where `text` is the raw command text. */
function candidates(src) {
  const out = [];
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const re = /(?:(?<![\w./-])|(?<=\\n))evnx(?=[ \t]+\S)/g;
  for (const m of src.matchAll(re)) {
    const idx = m.index;
    const before = src.slice(Math.max(0, idx - 80), idx);
    const lineHead = src.slice(lineStarts[lineOf(idx) - 1], idx);
    const afterQuote = /["'`]$/.test(before);
    const afterNewline = /\\n$/.test(before);
    const afterCodeTag = CODE_TAGS.test(before);
    const atLineStart = /^\s*$/.test(lineHead);
    // `$ evnx …` in a shell sample.
    const afterPrompt = /\$ $/.test(before);
    if (!(afterQuote || afterNewline || afterCodeTag || atLineStart || afterPrompt)) continue;

    const quote = afterQuote ? before.slice(-1) : null;
    let rest = src.slice(idx, src.indexOf("\n", idx) === -1 ? undefined : src.indexOf("\n", idx));
    // Placeholders first, so the terminator scan below cannot trip on the quotes
    // inside `{vault?.name ?? ""}`.
    rest = rest
      .replace(/\$\{[^{}]*\}/g, "<expr>")
      .replace(/\{[^{}]*\}/g, "<expr>")
      .replace(/&lt;([\w-]+)&gt;/g, "<$1>");

    // Terminators: the opening quote, a backtick, a literal \n, a closing tag,
    // a comment, or the end of the line.
    let end = rest.length;
    let closed = false;
    const stops = [
      quote ?? '"', "`", "\\n", "</", " # ", "\\\\",
    ];
    for (const s of stops) {
      const p = rest.indexOf(s, 1);
      if (p !== -1 && p < end) { end = p; closed = true; }
    }
    if (!quote) {
      const p = rest.indexOf('"', 1);
      if (p !== -1 && p < end) { end = p; closed = true; }
    }
    const text = rest.slice(0, end).replace(/(?:\s*[|;]|\s*&&).*$/, "").trim();
    out.push({ line: lineOf(idx), text, closed });
  }
  return out;
}

// ─── Check one invocation ────────────────────────────────────────────────────

const isPlaceholder = (t) => /^<[\w-]+>$/.test(t) || t === "<expr>" || t.includes("…");

/** Returns null when fine, else a human reason. */
function check({ text, closed }) {
  let toks = text.split(/\s+/).slice(1); // drop "evnx"
  // ⚠️ Everything after a bare `--` is the CHILD command (`evnx cloud run … --
  // ./deploy.sh`), which is not ours to validate.
  const dd = toks.indexOf("--");
  if (dd !== -1) toks = toks.slice(0, dd);
  // Trailing sentence punctuation clings to the last token in prose-ish text.
  toks = toks.map((t) => t.replace(/[.,:;)]+$/, (p) => (isPlaceholder(t) ? "" : p)));
  if (toks.length === 0) return null;

  // Resolve the longest command path.
  let path = [];
  let cmd = null;
  let i = 0;
  while (i < toks.length) {
    const kids = children.get(key(path));
    const next = kids?.get(toks[i]);
    if (!next) break;
    cmd = next;
    path = next.path;
    i++;
  }

  if (!cmd) {
    // First word is not a command. If it is a flag, `evnx --version` and friends.
    if (toks[0].startsWith("-")) return null;
    // Unclosed, or not command-shaped: prose that happens to start with "evnx".
    if (!closed || !/^[a-z][a-z0-9-]*$/.test(toks[0])) return null;
    if (isPlaceholder(toks[0])) return null;
    return `\`${toks[0]}\` is not an evnx command`;
  }

  const name = `evnx ${path.join(" ")}`;
  const args = argsOf(cmd);
  const hasPositional = args.some((a) => a.positional);
  const hasKids = children.has(key(path));

  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("--")) {
      const [flag, inline] = t.slice(2).split("=");
      if (BUILTIN_LONG.has(flag)) continue;
      const a = args.find((x) => x.long === flag);
      if (!a) return `\`${name}\` has no \`--${flag}\` flag`;
      if (a.takes_value && inline === undefined) i++; // consumes the next token
    } else if (t.startsWith("-") && t.length > 1) {
      // Short flags, possibly clustered (`-vq`); a value-taking one ends the cluster.
      for (const ch of t.slice(1)) {
        if (BUILTIN_SHORT.has(ch)) continue;
        const a = args.find((x) => x.short === ch);
        if (!a) return `\`${name}\` has no \`-${ch}\` flag`;
        if (a.takes_value) { if (t.length === 2) i++; break; }
      }
    } else {
      if (isPlaceholder(t) && !hasPositional) {
        // A placeholder where a subcommand would go is fine to leave unguessed.
        if (hasKids) return null;
      }
      if (hasPositional) continue;
      if (hasKids && !isPlaceholder(t)) return `\`${name}\` has no \`${t}\` subcommand`;
      return `\`${name}\` takes no positional argument, but got \`${t}\``;
    }
  }
  return null;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p === join(ROOT, "src", "data")) continue; // generated, and full of CLI text
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

const failures = [];
let checked = 0;
for (const file of walk(join(ROOT, "src"))) {
  const src = readFileSync(file, "utf8");
  for (const c of candidates(src)) {
    checked++;
    const why = check(c);
    if (why) failures.push(`${relative(ROOT, file)}:${c.line}  ${c.text}  → ${why}`);
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} evnx snippet(s) the CLI (${surface.evnx_version}) would reject:\n`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ ${checked} evnx snippets resolve against command-surface.json (evnx ${surface.evnx_version})`);
