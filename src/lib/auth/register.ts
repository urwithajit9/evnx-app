/**
 * Registration — every byte the server receives is derived in this browser.
 *
 * ─── What is sent, and what is not ───────────────────────────────────────────
 *
 * Sent: an SRP verifier, two salts, two public keys, and a private key sealed
 * under the master key. Not sent, at any point: the password, the master key,
 * the SRP password, or the private key in the clear.
 *
 * ─── Two salts, never one ────────────────────────────────────────────────────
 *
 * `srp_salt` and `argon2_salt` are independent 32-byte values. Sharing one would
 * tie the SRP verifier and the master key to the same Argon2id output, so an
 * offline attack on the verifier — which the server hands out in a breach —
 * would recover the key that opens the vaults directly.
 *
 * ─── Cost ────────────────────────────────────────────────────────────────────
 *
 * Two Argon2id derivations at 64 MiB, ~300 ms of solid CPU on a desktop and
 * several times that on a phone. It runs in the Worker; show progress.
 */

"use client";

import {
  computeVerifier,
  deriveMasterKey,
  deriveSrpPassword,
  encryptPrivateKey,
  generateKeypair,
  generateSalt,
  keypairPublicKeys,
  clearKeys,
} from "@/lib/crypto/client";
import { postRegister, type RegisterResult } from "@/lib/api/auth";
import { checkPasswordStrength, normalizeEmail, validateEmail } from "./credentials";

export type RegisterProgress =
  | "deriving-srp"
  | "deriving-master-key"
  | "generating-keypair"
  | "submitting";

export type RegisterInput = {
  email: string;
  password: string;
  onProgress?: (stage: RegisterProgress) => void;
};

export async function register({
  email,
  password,
  onProgress,
}: RegisterInput): Promise<RegisterResult> {
  const emailError = validateEmail(email);
  if (emailError) throw new Error(emailError);
  const passwordError = checkPasswordStrength(password);
  if (passwordError) throw new Error(passwordError);

  // Normalise BEFORE the verifier is computed. The address is the SRP identity,
  // so this exact string is what login must reproduce.
  const normalized = normalizeEmail(email);

  const [srpSaltB64, argon2SaltB64] = await Promise.all([
    generateSalt(),
    generateSalt(),
  ]);

  // The `try` opens here, before the first derivation, so that a failure at any
  // later step still reaches the zeroize below.
  try {
    onProgress?.("deriving-srp");
    const srpPasswordB64 = await deriveSrpPassword(password, srpSaltB64);
    const verifier = await computeVerifier(normalized, srpPasswordB64, srpSaltB64);

    onProgress?.("deriving-master-key");
    await deriveMasterKey(password, argon2SaltB64);

    onProgress?.("generating-keypair");
    const keypair = await generateKeypair();
    const publicKeys = await keypairPublicKeys(keypair);
    // Seals against the master key the Worker is holding from the step above.
    const encryptedPrivateKey = await encryptPrivateKey(keypair);

    onProgress?.("submitting");
    return await postRegister({
      email: normalized,
      srp_verifier: verifier.verifier,
      // From the verifier bundle rather than the local variable: one source for
      // the value that was actually mixed in, so the two cannot drift.
      srp_salt: verifier.srpSalt,
      argon2_salt: argon2SaltB64,
      ed25519_public_key: publicKeys.ed25519,
      x25519_public_key: publicKeys.x25519,
      // Required since evnx-crypto 0.2. Derived from the same seed, so producing
      // it costs nothing — and an account without it cannot be shared with.
      mlkem_public_key: publicKeys.mlkem,
      encrypted_private_key: encryptedPrivateKey,
    });
  } finally {
    // Registration does NOT sign the user in — the CLI prints "check your inbox"
    // and stops, and the browser does the same. With no session to use them, the
    // master key and keypair derived above have no further job, so zeroize both
    // rather than leave key material alive across the "check your email" screen.
    // Login re-derives them from the password and `GET /auth/me`.
    //
    // This runs on the failure path too, which is when it matters most.
    await clearKeys().catch(() => {});
  }
}
