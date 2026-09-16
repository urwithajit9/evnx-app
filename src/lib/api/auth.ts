/**
 * Auth endpoints, typed from evnx-server's request/response structs.
 *
 * ─── Encodings are mixed, and getting one wrong fails as "wrong password" ────
 *
 * There is no single convention on the wire. Read this table before touching
 * anything here; it comes from `evnx-server/src/routes/auth.rs` and the CLI's
 * `src/cloud/auth.rs`, not from a guess:
 *
 * | Field | Encoding |
 * |---|---|
 * | `srp_verifier`, `client_public`, `client_proof`, `server_proof` | **hex** |
 * | `srp_salt`, `argon2_salt` | **base64** (44 chars = 32 bytes) |
 * | `ed25519_public_key`, `x25519_public_key` | **base64** (44 chars) |
 * | `encrypted_private_key` | **base64** |
 *
 * The WASM bindings already return each value in the form its field wants, so
 * the correct code here is to pass them straight through without re-encoding.
 */

"use client";

import { api } from "./client";

// ─── Register ────────────────────────────────────────────────────────────────

export type RegisterBody = {
  email: string;
  srp_verifier: string;
  srp_salt: string;
  argon2_salt: string;
  ed25519_public_key: string;
  x25519_public_key: string;
  encrypted_private_key: string;
};

export type RegisterResult = {
  user_id: string;
  message: string;
};

export async function postRegister(body: RegisterBody) {
  const { data } = await api.post<RegisterResult>("/auth/register", body);
  return data;
}

// ─── SRP ─────────────────────────────────────────────────────────────────────

export type SrpInitResult = {
  session_id: string;
  /** base64 */
  srp_salt: string;
  /** base64 */
  argon2_salt: string;
  /** hex — the server's ephemeral `B` */
  server_public: string;
};

/**
 * Start the exchange.
 *
 * The server answers identically for a known and an unknown address — same
 * shape, same timing, plausible salts — so a 200 here means nothing about
 * whether the account exists. Do not add UI that implies otherwise; that would
 * rebuild the enumeration oracle the server goes out of its way to deny.
 */
export async function postSrpInit(email: string, clientPublicHex: string) {
  const { data } = await api.post<SrpInitResult>("/auth/srp/init", {
    email,
    client_public: clientPublicHex,
  });
  return data;
}

export type SrpVerifyResult = {
  /** hex — `M2`. Always present, in both branches. */
  server_proof: string;
  requires_totp: boolean;
  /** Present only when `requires_totp`. */
  totp_pending_token?: string;
  /** Absent when `requires_totp` — the tokens come from `/auth/totp/verify`. */
  access_token?: string;
  refresh_token?: string;
};

export async function postSrpVerify(sessionId: string, clientProofHex: string) {
  const { data } = await api.post<SrpVerifyResult>("/auth/srp/verify", {
    session_id: sessionId,
    client_proof: clientProofHex,
  });
  return data;
}

// ─── Second factor ───────────────────────────────────────────────────────────

export type TotpVerifyResult = {
  access_token: string;
  refresh_token: string;
  /**
   * How many recovery codes are left, after this one if a code was redeemed.
   *
   * Surface it below about three: hitting zero means the next lost phone is a
   * permanently locked account, and the vaults are unrecoverable by design.
   */
  backup_codes_remaining: number | null;
};

/**
 * Redeem the second factor.
 *
 * `code` is either a 6-digit TOTP or one of the `XXXXX-XXXXX` recovery codes —
 * the server accepts both on this endpoint, so the UI needs one field, not two.
 *
 * The pending token is **single-use and spent on success**; it is not spent on a
 * wrong code, so a mistyped digit does not send the user back through SRP.
 */
export async function postTotpVerify(pendingToken: string, code: string) {
  const { data } = await api.post<TotpVerifyResult>("/auth/totp/verify", {
    totp_pending_token: pendingToken,
    totp_code: code,
  });
  return data;
}

// ─── Email verification ──────────────────────────────────────────────────────

/** Redeem a verification token. 204 on success. */
export async function postVerifyEmail(token: string) {
  await api.post("/auth/verify-email", { token });
}

/**
 * Re-send the verification email.
 *
 * Always 202, whether the address is unknown, already verified or genuinely
 * pending — for the same anti-enumeration reason as `srp/init`. So the UI can
 * only ever say "if that address needs verifying, an email is on its way", and
 * must not claim the email was sent. Rate-limited to 3/hour server-side.
 */
export async function postResendVerification(email: string) {
  await api.post("/auth/resend-verification", { email });
}

// ─── Session ─────────────────────────────────────────────────────────────────

export type MeResult = {
  user_id: string;
  email: string;
  email_verified: boolean;
  /** base64, sealed under the master key. Useless without the password. */
  encrypted_private_key: string;
  /** base64 */
  argon2_salt: string;
  totp_enabled: boolean;
};

/**
 * The account, including the material needed to unwrap the keypair.
 *
 * Behind `require_auth`, not `require_verified` — deliberately, so an account
 * that has not yet clicked the email can still complete a first login. The
 * response is useless without the master password.
 */
export async function getMe() {
  const { data } = await api.get<MeResult>("/auth/me");
  return data;
}

export async function postLogout() {
  await api.post("/auth/logout");
}
