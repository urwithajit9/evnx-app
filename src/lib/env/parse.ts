/**
 * A `.env` reader for the viewer.
 *
 * ─── This is a display aid, not the source of truth ──────────────────────────
 *
 * `evnx cloud push` uploads the file's **raw bytes**, unchanged. Nothing is
 * normalised, reformatted or round-tripped through a parser, so what comes back
 * out of a pull is byte-identical to what went in. That guarantee is the point,
 * and this file must never become part of it.
 *
 * So the rule here is: parse for presentation, and keep the raw text available
 * so a disagreement is visible rather than silent. When a line cannot be read,
 * it is reported as unparsed instead of dropped — a viewer that quietly omits a
 * line is worse than one that admits it does not understand it.
 *
 * ─── Matched to the CLI's parser ─────────────────────────────────────────────
 *
 * `evnx/src/core/parser.rs` is a 1,000-line parser with configurable modes; this
 * covers its defaults: comments, `export ` prefixes, single/double/backtick
 * quotes, inline comments on unquoted values, and multiline quoted values.
 *
 * Deliberately **not** implemented: `$VAR` expansion. The CLI expands variables
 * when materialising a file, and doing it here would show a value that differs
 * from the stored text — inventing content in a page whose whole job is to show
 * you what is actually stored.
 */

export type EnvEntry = {
  key: string;
  value: string;
  /** 1-based line where the entry starts, for pointing at the raw text. */
  line: number;
  /** Quote character, or null when the value was bare. */
  quote: '"' | "'" | "`" | null;
};

export type EnvParse = {
  entries: EnvEntry[];
  /** Lines that are neither blank, comment, nor a readable assignment. */
  unparsed: { line: number; text: string }[];
};

// No `s` (dotAll) flag: this only ever runs against a single already-split
// line, so `.` never needs to cross a newline — and the flag would require an
// es2018 compile target for no benefit.
const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/;

export function parseEnv(text: string): EnvParse {
  const entries: EnvEntry[] = [];
  const unparsed: EnvParse["unparsed"] = [];

  // Normalise CRLF so a file authored on Windows does not leave a trailing \r
  // on every value — which would be invisible on screen and wrong on copy.
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const m = ASSIGNMENT.exec(trimmed);
    if (!m) {
      unparsed.push({ line: i + 1, text: raw });
      continue;
    }

    const key = m[1];
    const rest = m[2];
    const startLine = i + 1;
    const opening = rest.trimStart()[0];

    if (opening === '"' || opening === "'" || opening === "`") {
      const quote = opening as '"' | "'" | "`";
      const afterQuote = rest.trimStart().slice(1);

      const closed = closingIndex(afterQuote, quote);
      if (closed >= 0) {
        entries.push({
          key,
          value: unescape(afterQuote.slice(0, closed), quote),
          line: startLine,
          quote,
        });
        continue;
      }

      // Multiline: keep consuming until the closing quote, or give up at the
      // end of the file and report the whole run as unparsed rather than
      // silently swallowing the remainder.
      const parts = [afterQuote];
      let j = i + 1;
      let found = false;
      for (; j < lines.length; j++) {
        const end = closingIndex(lines[j], quote);
        if (end >= 0) {
          parts.push(lines[j].slice(0, end));
          found = true;
          break;
        }
        parts.push(lines[j]);
      }

      if (found) {
        entries.push({
          key,
          value: unescape(parts.join("\n"), quote),
          line: startLine,
          quote,
        });
        i = j;
      } else {
        unparsed.push({ line: startLine, text: raw });
      }
      continue;
    }

    // Bare value: an unquoted `#` starts a comment, and nothing is unescaped —
    // a backslash in a bare value is a literal backslash.
    let value = rest.trim();
    const hash = value.indexOf("#");
    if (hash >= 0) value = value.slice(0, hash).trimEnd();
    entries.push({ key, value, line: startLine, quote: null });
  }

  return { entries, unparsed };
}

/** Index of the closing quote, skipping `\"` inside a double-quoted value. */
function closingIndex(s: string, quote: '"' | "'" | "`"): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return -1;
}

/**
 * Only double quotes carry escapes, matching shell and dotenv convention:
 * inside `'` and `` ` `` a backslash is a literal backslash.
 */
function unescape(s: string, quote: '"' | "'" | "`"): string {
  if (quote !== '"') return s;
  return s.replace(/\\([nrt"\\])/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
  );
}

/**
 * A stable, rough indicator of a value's shape for the masked state.
 *
 * Returns the length only. Not a preview of the first or last characters:
 * revealing the tail of an API key is a habit borrowed from payment UIs, where
 * the last four digits are deliberately non-secret. Here they are as secret as
 * the rest, and they narrow a search.
 */
export function maskFor(value: string): string {
  return "•".repeat(Math.min(Math.max(value.length, 3), 24));
}
