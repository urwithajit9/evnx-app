/**
 * Sharing a vault — the send half.
 *
 * ```
 * GET  /users/{email}/public-key     → x25519 + ML-KEM public keys
 *   wrapVaultKeyForUser(vk, …)       → {encryptedVaultKey, ephPubKey, mlkemCiphertext}
 * POST /vaults/{id}/members          → the recipient can now open it
 * ```
 *
 * The vault key is unwrapped and re-wrapped entirely in the Worker. The server
 * receives a bundle it cannot open and never sees the key, exactly as with a
 * push.
 *
 * ─── What sharing costs, stated plainly ─────────────────────────────────────
 *
 * ⚠️ **The recipient's public keys come from the server.** A malicious server
 * could substitute its own and read everything shared afterwards. There is no
 * third party to check them against, and out-of-band fingerprint verification is
 * not built — so "the server cannot read your secrets" becomes "…cannot read them
 * *passively*" the moment you share. The CLI carries the same caveat and the UI
 * repeats it where the action happens, rather than here where nobody reads it.
 */

"use client";

import {
  addMember,
  getRecipientKeys,
  type VaultRole,
} from "@/lib/api/vaults";
import { apiErrorStatus } from "@/lib/api/client";
import { wrapVaultKeyForUser } from "@/lib/crypto/client";
import { vaultKeyFor } from "@/lib/vaults/open";

/**
 * Share `vaultId` with `email` at `role`.
 *
 * Throws with a message meant for a person. Every failure here is terminal —
 * none of them should be retried into a weaker path.
 */
export async function shareVault(
  vaultId: string,
  email: string,
  role: VaultRole,
): Promise<void> {
  const recipient = email.trim().toLowerCase();

  // ── The recipient's keys, before anything else ───────────────────────────
  //
  // Deliberately first, matching the CLI. If the share cannot happen, saying so
  // before unwrapping a vault key is better than after — and it is the fastest
  // path to the most common error, which is a typo'd address.
  let keys;
  try {
    keys = await getRecipientKeys(recipient);
  } catch (e) {
    if (apiErrorStatus(e) === 404) {
      throw new Error(
        `No evnx account for ${recipient}. They need to register first — the vault key is wrapped to their public key, so there has to be one.`,
      );
    }
    throw e;
  }

  // ⚠️ No fallback, ever. Wrapping under X25519 alone produces a row a quantum
  // computer opens, and it stays that way for as long as the row exists — an
  // adversary recording it today does not care that a later version fixed the
  // algorithm. The server agrees: `mlkem_ciphertext` is a required field, not an
  // optional one.
  if (!keys.mlkem_public_key) {
    throw new Error(
      `${recipient} has no post-quantum sharing key yet. They need to sign in once — here or with evnx 0.5 or later — which registers it automatically.`,
    );
  }

  // ⚠️ There used to be a guard here refusing to share a vault that had been
  // shared *with* you — "re-sharing is not supported" — on the reasoning that our
  // own copy is sealed under the master key while a shared copy is wrapped to our
  // keypair, and this path could only re-wrap from the first form.
  //
  // That stopped being true when `vaultKeyFor` learned to unwrap both. It takes
  // whichever form you hold and returns the same vault key either way, so there is
  // nothing left to re-wrap *from* — the key is the key, however it arrived.
  //
  // Exactly the staleness `open.ts` already records one level down, where the app
  // threw "use the CLI" for a capability the Worker had carried since F1. Two
  // guards written against the same missing feature; this is the second one.
  //
  // The server has always permitted this: `add_member` is guarded by
  // `AtLeastAdmin`, with the note that sharing hands out a key and so is not a
  // developer-level act. Refusing here made the app stricter than the API for no
  // cryptographic reason.
  const vaultKey = await vaultKeyFor(vaultId);
  const bundle = await wrapVaultKeyForUser(
    vaultKey,
    keys.x25519_public_key,
    keys.mlkem_public_key,
  );

  await addMember(vaultId, {
    user_email: recipient,
    role,
    encrypted_vault_key: bundle.encryptedVaultKey,
    eph_pub_key: bundle.ephPubKey,
    mlkem_ciphertext: bundle.mlkemCiphertext,
  });
}
