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
