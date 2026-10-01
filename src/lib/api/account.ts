/**
 * Account settings — two-factor, sessions, API tokens.
 *
 * Every route here sits behind `require_user_session`, which rejects an
 * `evnx_tok_` API token with **403**. That is deliberate and worth understanding
 * before touching anything: a CI token that could reach `/auth/totp/setup` and
 * `/auth/totp/confirm` would be able to enrol its own authenticator on the
 * victim's account, and one that could reach `/auth/tokens` could mint itself a
 * longer-lived replacement and survive revocation of the original.
 *
 * So 403 here means "wrong kind of credential", not "not allowed" — a distinction
 * the UI never needs to make, because a browser session is always the right kind.
 */

"use client";

import { api } from "./client";

// ─── Two-factor ──────────────────────────────────────────────────────────────

export type TotpSetup = {
  /** `otpauth://totp/...` — contains the secret. Never send it anywhere. */
  totp_uri: string;
  /** The same secret, for typing in by hand when a camera is not an option. */
  secret_base32: string;
};

/**
 * Begin enrolment. The secret is held **unconfirmed** in Valkey for 10 minutes
 * and is not attached to the account until `/totp/confirm` succeeds — so
 * abandoning this flow leaves nothing behind and locks nobody out.
 */
export async function totpSetup(): Promise<TotpSetup> {
  const { data } = await api.post<TotpSetup>("/auth/totp/setup");
  return data;
}

export type BackupCodes = {
  /** Ten `XXXXX-XXXXX` codes. Shown once; the server keeps only hashes. */
  backup_codes: string[];
  note: string;
};

/** Prove the authenticator works, which enables 2FA and issues recovery codes. */
export async function totpConfirm(code: string): Promise<BackupCodes> {
  const { data } = await api.post<BackupCodes>("/auth/totp/confirm", {
    totp_code: code.trim(),
  });
  return data;
}

/**
 * Turn 2FA off. Requires a **current second factor**, not merely a live session —
 * otherwise a stolen session could strip the protection it is supposed to defeat.
 * Also deletes the recovery codes.
 */
export async function totpDisable(code: string): Promise<void> {
  await api.post("/auth/totp/disable", { totp_code: code.trim() });
}

/** Reissue recovery codes. The previous set stops working immediately. */
export async function totpRegenerateBackupCodes(code: string): Promise<BackupCodes> {
  const { data } = await api.post<BackupCodes>("/auth/totp/backup-codes", {
    totp_code: code.trim(),
  });
  return data;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export type SessionSummary = {
  session_id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  /** The session making the request. Revoking it signs this tab out. */
  current: boolean;
};

export async function listSessions(): Promise<SessionSummary[]> {
  const { data } = await api.get<{ sessions: SessionSummary[] }>("/auth/sessions");
  return data.sessions;
}

/**
 * Revoke one session.
 *
 * Kills its refresh tokens **and** blocklists the session id in Valkey, so the
 * access token dies immediately rather than lingering for its remaining 15
 * minutes. That matters: without the blocklist, "sign out that other device"
 * would leave it working for a quarter of an hour.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await api.delete(`/auth/sessions/${sessionId}`);
}

/** Revoke every session except this one. */
export async function revokeOtherSessions(): Promise<void> {
  await api.delete("/auth/sessions/others");
}

// ─── API tokens ──────────────────────────────────────────────────────────────

export type ApiToken = {
  id: string;
  name: string;
  /** `read` | `read_write` */
  scope: string;
  /** Non-null means the token reaches only that vault. */
  vault_id: string | null;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

export async function listTokens(): Promise<ApiToken[]> {
  const { data } = await api.get<{ tokens: ApiToken[] }>("/auth/tokens");
  return data.tokens;
}

export type CreatedToken = {
  id: string;
  /** The only time this is ever returned. The server stores a BLAKE3 hash. */
  raw_token: string;
  name: string;
  scope: string;
  expires_at: string | null;
  note: string;
};

export async function createToken(input: {
  name: string;
  scope: "read" | "read_write";
  vault_id?: string;
  expires_in_days?: number;
}): Promise<CreatedToken> {
  const { data } = await api.post<CreatedToken>("/auth/tokens", input);
  return data;
}

export async function revokeToken(tokenId: string): Promise<void> {
  await api.delete(`/auth/tokens/${tokenId}`);
}

/**
 * Delete this account, and everything only it can reach.
 *
 * ⚠️ **Irreversible, and not a logout.** Sessions, API tokens, 2FA enrolment and
 * every vault this account is the only member of are destroyed, ciphertext
 * included. The server never held anything that could rebuild them.
 *
 * Vaults the account owns that other people are members of make the server
 * refuse with 409, naming them — deleting would take those vaults and everyone
 * else's access with them. The message is written for a person; show it as-is.
 *
 * `confirmEmail` is checked server-side too. It guards against a misclick rather
 * than an attacker, who would know their own address; `totpCode` is the control,
 * and the endpoint refuses API tokens entirely.
 */
export async function deleteAccount(
  confirmEmail: string,
  totpCode?: string,
): Promise<void> {
  await api.delete("/auth/account", {
    // ⚠️ A body on DELETE. Legal but unusual, and some intermediaries drop it —
    // tolerable only because of which way it fails: without `confirm_email` the
    // server refuses rather than deletes.
    data: {
      confirm_email: confirmEmail,
      ...(totpCode ? { totp_code: totpCode } : {}),
    },
  });
}

// ─── Changing the master password ────────────────────────────────────────────

export type ChallengeResult = {
  session_id: string;
  /** base64 */
  srp_salt: string;
  /** base64 */
  argon2_salt: string;
  /** hex — the server's ephemeral `B` */
  server_public: string;
};

/**
 * Start proving the **current** password again, inside a live session.
 *
 * ⚠️ A session is not enough to change a master password, and the reason is worth
 * knowing. Someone holding a stolen session cannot produce a *valid* rotation —
 * that needs the old password, to unwrap before re-wrapping — but the server
 * holds only ciphertext and cannot tell a valid one from random bytes. It would
 * store the garbage, and the account would be unopenable forever.
 *
 * A recency check on the access token was considered and rejected: `/auth/refresh`
 * re-stamps `iat`, so it measures something an attacker with the refresh token
 * controls. Only a fresh proof of the password means what it needs to mean.
 *
 * No email is sent — the server reads it from the session, so unlike `/srp/init`
 * there is no enumeration surface here.
 */
export async function reauthInit(clientPublicHex: string) {
  const { data } = await api.post<ChallengeResult>("/auth/reauth/init", {
    client_public: clientPublicHex,
  });
  return data;
}

/**
 * Finish the proof. On success the server arms the rotation for **this session
 * only**, for five minutes.
 *
 * `totpCode` is required when the account has 2FA, and a backup code is accepted
 * in its place. The two checks defend against different people: the proof stops
 * whoever stole a session, the code stops whoever phished the password.
 */
export async function reauthVerify(
  sessionId: string,
  clientProofHex: string,
  totpCode?: string,
): Promise<{ server_proof: string }> {
  const { data } = await api.post<{ server_proof: string }>(
    "/auth/reauth/verify",
    {
      session_id: sessionId,
      client_proof: clientProofHex,
      ...(totpCode ? { totp_code: totpCode } : {}),
    },
  );
  return data;
}

export type RotateResult = {
  status: "rotated" | "already_applied";
  vaults_rewrapped: number;
  sessions_revoked: number;
  /** RFC3339, or null when no undo was kept. */
  undo_available_until: string | null;
};

/**
 * Swap the password and every wrap that depends on it, atomically.
 *
 * ⚠️ `wraps` must name **every** vault key held under the master key — not a
 * subset. The server checks the set against locked rows and refuses the whole
 * request otherwise, because a vault left wrapped under a password nobody holds
 * any more is simply gone.
 *
 * Vaults shared *to* this account are wrapped to its keypair, which a rotation
 * re-seals rather than replaces. They are untouched, and must not be listed here.
 *
 * `reason: "compromised"` keeps no undo. Use it when the old password is believed
 * to be in someone else's hands — an undo authorised by that password would hand
 * the account straight back.
 */
export async function rotateMasterKey(body: {
  srp_salt: string;
  srp_verifier: string;
  argon2_salt: string;
  encrypted_private_key: string;
  vault_wraps: { vault_id: string; encrypted_vault_key: string }[];
  reason: "routine" | "compromised";
}): Promise<RotateResult> {
  const { data } = await api.post<RotateResult>("/auth/master-key", body);
  return data;
}

// ─── Data export (GDPR Article 20) ───────────────────────────────────────────

/**
 * Everything the server holds about this account, as JSON.
 *
 * ⚠️ **No secrets, and that is structural rather than a policy choice.** Vault
 * contents are encrypted on the client under a key derived from the master
 * password; the server has never held that password, that key, or any plaintext
 * value, so it has nothing to put here. The document says so itself and names
 * `evnx cloud pull` — a reader who finds no values needs to learn why from the
 * artefact, not from a guide they may never open.
 *
 * Nothing usable as a credential is included either: not the SRP verifier (which
 * would be password-equivalent for an offline attack), not the TOTP secret, not
 * API token values.
 *
 * Typed as `unknown` on purpose. A declared shape here would silently drop any
 * field the server adds later, turning "everything we hold" into "everything
 * this build knew about" — which is the one promise the feature makes.
 */
export async function exportAccount(): Promise<unknown> {
  const { data } = await api.get<unknown>("/auth/account/export");
  return data;
}
