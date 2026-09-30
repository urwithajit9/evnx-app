/**
 * Changing the master password, and undoing it.
 *
 * ─── Why this is not a settings toggle ───────────────────────────────────────
 *
 * The master key is derived from the password, so changing the password
 * re-derives the key and **every vault key wrapped under it has to be re-wrapped
 * in the same breath**. That happens in the Worker; the server performs an atomic
 * swap of blobs it cannot read.
 *
 * ─── The check only this side can make ───────────────────────────────────────
 *
 * ⚠️ **The server cannot tell a correct rotation from random bytes.** That is the
 * zero-knowledge guarantee, not a gap in it. The server checks the payload is
 * *complete* — it knows how many wraps the account holds — but never that it is
 * *correct*. A wrong-but-well-formed wrap would be stored without complaint and
 * found by someone who can no longer open anything.
 *
 * So the Worker re-opens everything it just produced before this module is
 * allowed to send it. See `rotateMasterKey` in `crypto.worker.ts`.
 *
 * ─── Order, and why it is this order ─────────────────────────────────────────
 *
 * 1. read the account, and every vault key wrapped under the master key;
 * 2. build and verify the new material, in the Worker;
 * 3. prove the **current** password to the server;
 * 4. swap;
 * 5. install the new key in the Worker — only now, and only if 4 succeeded.
 *
 * Step 3 sits after step 2 because the proof is good for five minutes and step 2
 * runs Argon2id once per vault. Proving first would mean racing our own KDF.
 */

"use client";

import {
  reauthInit,
  reauthVerify,
  rotateMasterKey as postRotate,
  type RotateResult,
} from "@/lib/api/account";
import { getMe, postUndoInit, postUndoVerify, type UndoResult } from "@/lib/api/auth";
import { b64ToBytes, bytesToB64 } from "@/lib/api/encoding";
import { getMyKey, listVaults } from "@/lib/api/vaults";
import {
  clearSrpState,
  clientProof,
  commitRotation,
  computeClientProof,
  deriveSrpPassword,
  discardRotation,
  ephemeralPublicA,
  generateClientEphemeral,
  rotateMasterKey as workerRotate,
  verifyServerProof,
} from "@/lib/crypto/client";

/** Normalised exactly as the server stores it, and as SRP mixes it in. */
function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export type RotationStage =
  | "reading"
  | "rewrapping"
  | "proving"
  | "swapping"
  | "done";

export type RotationSummary = RotateResult & {
  /** Vaults shared *to* this account, which a rotation does not touch. */
  untouchedShared: number;
};

/**
 * Change the master password.
 *
 * `onStage` is called as it moves; the whole thing takes seconds, dominated by
 * one Argon2id derivation per vault, so a UI without progress reads as hung.
 */
export async function changeMasterPassword(input: {
  currentPassword: string;
  newPassword: string;
  /** Required when the account has 2FA. A backup code is accepted. */
  totpCode?: string;
  compromised: boolean;
  onStage?: (stage: RotationStage) => void;
}): Promise<RotationSummary> {
  const stage = input.onStage ?? (() => {});

  // ── 1. What the rotation has to cover ──────────────────────────────────────
  stage("reading");
  const me = await getMe();
  const email = normaliseEmail(me.email);

  const vaults = await listVaults();

  // ⚠️ One request per vault, because `GET /vaults` does not say which wrap mode
  // a membership uses — only `/my-key` does, by whether the key-agreement fields
  // are present. Guessing from the role would be wrong: an owner can also hold a
  // vault that was shared to them.
  const own: { vaultId: string; wrapped: Uint8Array }[] = [];
  let untouchedShared = 0;

  for (const v of vaults) {
    const key = await getMyKey(v.id);
    if (key.eph_pub_key == null && key.mlkem_ciphertext == null) {
      own.push({ vaultId: v.id, wrapped: b64ToBytes(key.encrypted_vault_key) });
    } else {
      // Wrapped to the keypair, which this re-seals rather than replaces. Sending
      // it would make the server refuse the whole rotation.
      untouchedShared++;
    }
  }

  // ── 2. Build it, and check it opens ────────────────────────────────────────
  stage("rewrapping");
  const payload = await workerRotate({
    email,
    newPassword: input.newPassword,
    sealedPrivateKeyB64: me.encrypted_private_key,
    wraps: own,
  });

  try {
    // ── 3. Prove the password being replaced ─────────────────────────────────
    stage("proving");
    await proveCurrentPassword(email, input.currentPassword, input.totpCode);

    // ── 4. Swap ──────────────────────────────────────────────────────────────
    stage("swapping");
    const result = await postRotate({
      srp_salt: payload.srpSalt,
      srp_verifier: payload.verifier,
      argon2_salt: payload.argon2Salt,
      encrypted_private_key: payload.encryptedPrivateKey,
      vault_wraps: payload.wraps.map((w) => ({
        vault_id: w.vaultId,
        encrypted_vault_key: bytesToB64(w.wrapped),
      })),
      reason: input.compromised ? "compromised" : "routine",
    });

    // ── 5. Only now ──────────────────────────────────────────────────────────
    //
    // ⚠️ `already_applied` means a previous attempt reached the server after all,
    // so the account is on the new password and this session's pending key is the
    // right one. Committing is correct in both branches; discarding on
    // `already_applied` would leave the session holding a key the server
    // replaced, and every vault would stop opening.
    await commitRotation();
    stage("done");
    return { ...result, untouchedShared };
  } catch (e) {
    // Nothing was installed, so the session still opens everything it did before.
    await discardRotation().catch(() => {});
    throw e;
  }
}

/** Run the SRP exchange against the account's **current** verifier. */
async function proveCurrentPassword(
  email: string,
  password: string,
  totpCode?: string,
) {
  const ephemeral = await generateClientEphemeral();
  try {
    const init = await reauthInit(await ephemeralPublicA(ephemeral));
    const srpPassword = await deriveSrpPassword(password, init.srp_salt);
    const proof = await computeClientProof(
      email,
      srpPassword,
      init.srp_salt,
      init.server_public,
      ephemeral,
    );
    const { server_proof } = await reauthVerify(
      init.session_id,
      await clientProof(proof),
      totpCode,
    );
    // The server proves it holds the verifier, as at login. Skipping this gives
    // up the half of SRP that authenticates the *server*.
    await verifyServerProof(server_proof, proof);
  } finally {
    await clearSrpState().catch(() => {});
  }
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * Restore the material a rotation replaced, by proving the previous password.
 *
 * ⚠️ Takes no session, deliberately: whoever needs this is whoever the change
 * locked out. It touches no key material — the server swaps rows back — so
 * nothing here needs the Worker beyond the SRP exchange.
 *
 * A wrong password and an address with nothing to undo fail identically, because
 * the server fabricates a challenge when it has nothing to offer. Do not write UI
 * that distinguishes them.
 */
export async function undoPasswordChange(
  emailInput: string,
  previousPassword: string,
): Promise<UndoResult> {
  const email = normaliseEmail(emailInput);
  const ephemeral = await generateClientEphemeral();
  try {
    const init = await postUndoInit(email, await ephemeralPublicA(ephemeral));
    const srpPassword = await deriveSrpPassword(previousPassword, init.srp_salt);
    const proof = await computeClientProof(
      email,
      srpPassword,
      init.srp_salt,
      init.server_public,
      ephemeral,
    );
    const result = await postUndoVerify(init.session_id, await clientProof(proof));
    await verifyServerProof(result.server_proof, proof);
    return result;
  } finally {
    await clearSrpState().catch(() => {});
  }
}
