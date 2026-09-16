/**
 * Sign-in — SRP-6a, then the second factor, then unwrap the keypair.
 *
 * ─── SRP authenticates BOTH directions ───────────────────────────────────────
 *
 * The client proves it knows the password with `M1`; the server proves it holds
 * the matching verifier with `M2`. Skipping the `M2` check throws away half the
 * protocol — it is the only thing stopping an impostor server, one that never
 * had the verifier, from completing a login and being believed.
 *
 * So {@link verifyServerProof} is called **before a single token is accepted**,
 * on both the TOTP branch and the plain one. Its rejection is rewritten into a
 * {@link ServerProofError} and rethrown — never recovered from. If you find
 * yourself making that `catch` continue, stop: there is nothing to handle. The
 * peer is not the server the account was registered with.
 *
 * ─── Two derivations ─────────────────────────────────────────────────────────
 *
 * A login runs Argon2id twice — once for the SRP proof, once to unwrap the
 * keypair — against two different salts. ~300 ms of CPU on a desktop, more on a
 * phone. Both run in the Worker.
 *
 * ─── The password is needed until the very end ───────────────────────────────
 *
 * The master key cannot be derived until the session exists: its salt comes from
 * `GET /auth/me`, which is authenticated. So the password stays in scope across
 * the whole exchange — and across the code prompt, when the account has a second
 * factor. That is inherent to the design, not an oversight; the sign-in form's
 * own password field holds the same string for the same span.
 */

"use client";

import {
  clearKeys,
  clearSrpState,
  computeClientProof,
  clientProof,
  decryptPrivateKey,
  deriveMasterKey,
  deriveSrpPassword,
  ephemeralPublicA,
  generateClientEphemeral,
  verifyServerProof,
} from "@/lib/crypto/client";
import {
  getMe,
  postSrpInit,
  postSrpVerify,
  postTotpVerify,
  type MeResult,
} from "@/lib/api/auth";
import { setTokens } from "@/lib/api/client";
import { normalizeEmail } from "./credentials";

export type LoginProgress =
  | "starting"
  | "deriving"
  | "verifying"
  | "awaiting-second-factor"
  | "unlocking";

/**
 * The login paused for a second factor.
 *
 * SRP is already complete at this point and the server has proved itself — only
 * the second factor is outstanding. Call {@link completeSecondFactor} with the
 * code; do not restart the exchange.
 */
export type SecondFactorRequired = {
  status: "totp-required";
  pendingToken: string;
  /**
   * Still needed: the master key cannot be derived until the second factor
   * succeeds, and deriving it early would mean ~150 ms of CPU spent on a login
   * that may never finish, plus a master key sitting in the Worker while the
   * session is still unauthenticated.
   *
   * This is not a new exposure — the sign-in form's password field already holds
   * the same string, in the same heap, for the whole exchange. Hold this object
   * no longer than the code prompt, and drop it when the user navigates away.
   */
  password: string;
};

export type LoginComplete = {
  status: "signed-in";
  me: MeResult;
  /** Non-null only after a TOTP login. Warn the user below about three. */
  backupCodesRemaining: number | null;
};

export type LoginResult = SecondFactorRequired | LoginComplete;

export class ServerProofError extends Error {
  constructor() {
    super(
      "The server could not prove it holds your verifier, so this is not the server you registered with. No session was started.",
    );
    this.name = "ServerProofError";
  }
}

export type LoginInput = {
  email: string;
  password: string;
  onProgress?: (stage: LoginProgress) => void;
};

export async function login({
  email,
  password,
  onProgress,
}: LoginInput): Promise<LoginResult> {
  // The SRP identity. Must match registration exactly — see `normalizeEmail`.
  const normalized = normalizeEmail(email);

  try {
    onProgress?.("starting");
    const ephemeral = await generateClientEphemeral();
    const publicA = await ephemeralPublicA(ephemeral);

    // Answers identically for an unknown address, with plausible salts, so a
    // response here says nothing about whether the account exists.
    const init = await postSrpInit(normalized, publicA);

    onProgress?.("deriving");
    const srpPasswordB64 = await deriveSrpPassword(password, init.srp_salt);
    const proof = await computeClientProof(
      normalized,
      srpPasswordB64,
      init.srp_salt,
      init.server_public,
      ephemeral,
    );

    onProgress?.("verifying");
    const verify = await postSrpVerify(init.session_id, await clientProof(proof));

    // ── The server proves itself, before anything it sent is trusted ─────────
    //
    // The `catch` here only replaces the message — it rethrows unconditionally
    // and there is no path past it. That distinction matters: swallowing this
    // failure and continuing would hand a session to whatever is in the middle,
    // and the tokens sitting in the same response would be worth nothing.
    //
    // Note this runs BEFORE `setTokens` and before the TOTP branch, so neither
    // outcome can reach a token that an unproven server issued.
    try {
      await verifyServerProof(verify.server_proof, proof);
    } catch {
      throw new ServerProofError();
    }

    if (verify.requires_totp) {
      if (!verify.totp_pending_token) {
        throw new Error(
          "The server asked for a second factor but sent no pending token.",
        );
      }
      onProgress?.("awaiting-second-factor");
      // The master key is NOT derived yet. Doing it here would spend ~150 ms of
      // CPU on a login that may never complete, and would leave a master key in
      // the Worker while the session is still unauthenticated.
      return {
        status: "totp-required",
        pendingToken: verify.totp_pending_token,
        password,
      };
    }

    if (!verify.access_token || !verify.refresh_token) {
      throw new Error("The server completed SRP but sent no tokens.");
    }
    setTokens(verify.access_token, verify.refresh_token);

    onProgress?.("unlocking");
    const me = await unlock(password);
    return { status: "signed-in", me, backupCodesRemaining: null };
  } finally {
    // The ephemeral and the proof are single-use and their exchange is over,
    // whichever way this went. The master key and keypair — if `unlock` got that
    // far — are untouched.
    await clearSrpState().catch(() => {});
  }
}

/**
 * Finish a login that stopped at the second factor.
 *
 * `code` is either a 6-digit TOTP or a `XXXXX-XXXXX` recovery code; the server
 * takes both here, so the UI needs one field.
 *
 * A wrong code does **not** spend the pending token — let the user retry against
 * the same {@link SecondFactorRequired} rather than sending them back through
 * SRP. The token itself expires after five minutes.
 */
export async function completeSecondFactor(
  pending: SecondFactorRequired,
  code: string,
  onProgress?: (stage: LoginProgress) => void,
): Promise<LoginComplete> {
  const totp = await postTotpVerify(pending.pendingToken, code.trim());
  setTokens(totp.access_token, totp.refresh_token);

  onProgress?.("unlocking");
  const me = await unlock(pending.password);
  return {
    status: "signed-in",
    me,
    backupCodesRemaining: totp.backup_codes_remaining,
  };
}

/**
 * Derive the master key and recover the keypair.
 *
 * `GET /auth/me` sits behind `require_auth`, not `require_verified`, so this
 * works for an account that has not yet clicked its verification link — which is
 * what lets someone sign in and see the "verify your email" state rather than
 * being locked out of their own account.
 *
 * `argon2_salt` comes from here and **not** from `srp/init`, matching the CLI.
 * `srp/init` answers unknown addresses with a fabricated salt to deny
 * enumeration, so its copy is only trustworthy in hindsight; this one is
 * authenticated. The salt is not a secret — fetching it is what lets both
 * clients avoid caching anything between sessions.
 */
async function unlock(password: string): Promise<MeResult> {
  const me = await getMe();
  try {
    await deriveMasterKey(password, me.argon2_salt);
    // Fails exactly when the password is wrong — which SRP has already ruled
    // out, so a failure here means the stored blob does not match the account.
    await decryptPrivateKey(me.encrypted_private_key);
    return me;
  } catch (e) {
    // Never leave a half-unlocked session: a master key with no keypair reads as
    // signed in to the key store and cannot actually complete a vault operation.
    await clearKeys().catch(() => {});
    throw e;
  }
}
