/**
 * Email and password rules, mirrored from the CLI.
 *
 * These are not cosmetic form validation — `normalizeEmail` is load-bearing
 * cryptography. Keep them in step with `evnx/src/cloud/auth.rs`.
 */

/**
 * Fold an address to the form the server stores, and to the SRP **identity**.
 *
 * The email is mixed into the SRP verifier at registration. If someone registers
 * as `Ajit@Example.com` and later signs in as `ajit@example.com`, the proof is
 * computed over a different identity string and the exchange fails — surfacing
 * as "wrong password" for a password that is perfectly correct, with nothing in
 * the UI to suggest why.
 *
 * evnx-server trims and lowercases in both `register` and `srp/init`, and the
 * CLI does the same. This must not diverge from either.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Shape check only. Real validation is the verification email — anything else
 * is guesswork about what a mail server will accept.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return "Enter your email address.";
  if (trimmed.length > 254) return "That email address is too long (max 254 characters).";
  // Whitespace anywhere, not just in the domain: the CLI's first version checked
  // only the domain and happily accepted "a b@example.com".
  if (/\s/.test(trimmed)) return "That does not look like an email address.";

  const at = trimmed.indexOf("@");
  if (at < 0) return "That does not look like an email address.";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain || !domain.includes(".")) {
    return "That does not look like an email address.";
  }
  return null;
}

/** Matches the CLI's `MIN_PASSWORD_LEN`. */
export const MIN_PASSWORD_LEN = 12;

/**
 * Length only, and only a floor — no character-class rules.
 *
 * The threat here is offline: the server holds an SRP verifier, and a breach
 * lets an attacker grind it at their own pace. Length is what defeats that;
 * forcing a symbol into an eight-character password does not. Four or five
 * unrelated words beat a short complex string on both strength and recall.
 *
 * There is **no reset** — the master password is the only thing that opens the
 * vaults, and the server holds nothing that could rebuild it.
 */
export function checkPasswordStrength(password: string): string | null {
  // Count code points, not UTF-16 units, so an emoji is one character rather
  // than two. `.length` would let a shorter password through than it appears.
  const len = [...password].length;
  if (len < MIN_PASSWORD_LEN) {
    return `Your master password must be at least ${MIN_PASSWORD_LEN} characters (got ${len}). It cannot be reset, so make it a passphrase you will remember.`;
  }
  return null;
}
