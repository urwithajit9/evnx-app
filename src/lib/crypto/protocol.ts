/**
 * Message protocol between the main thread and the crypto Worker.
 *
 * ─── The rule this protocol exists to enforce ────────────────────────────────
 *
 * **No key material ever crosses back to the main thread.**
 *
 * The Worker owns every `MasterKeyHandle` and `VaultKeyHandle`. The main thread
 * holds nothing but request ids and results. There is deliberately no message
 * that returns a key, so no amount of UI code can accidentally put one in
 * `localStorage`, a React state tree, or a Redux devtools snapshot.
 *
 * The password does travel *into* the Worker — it is the input to the KDF, so
 * there is no way around that — but it is used and dropped, never stored.
 */

/** Opaque reference to a vault key living in Worker memory. */
export type VaultKeyRef = string;

/** Opaque reference to one login's SRP ephemeral. Single-use. */
export type SrpEphemeralRef = string;

/**
 * Opaque reference to the client's SRP proof state.
 *
 * Must stay alive between sending `M1` and checking the server's `M2` — it holds
 * the state that makes that check possible. Releasing it early silently discards
 * the half of SRP that proves the *server* holds your verifier.
 */
export type SrpProofRef = string;

/** Opaque reference to the user's Ed25519 + X25519 keypair. */
export type KeypairRef = string;

/** What registration sends for the SRP half. Both are safe to transmit. */
export type VerifierBundle = {
  /** Hex, for `srp_verifier`. */
  verifier: string;
  /** Base64, for `srp_salt`. */
  srpSalt: string;
};

/** Public halves of a keypair. Safe to transmit. */
export type PublicKeys = {
  /** Base64, for `ed25519_public_key`. */
  ed25519: string;
  /** Base64, for `x25519_public_key`. */
  x25519: string;
};

export type CryptoRequest =
  | { id: number; kind: "init" }
  /** Derive the master key. Argon2id at 64 MiB — expect ~150 ms on a desktop. */
  | { id: number; kind: "deriveMasterKey"; password: string; argon2SaltB64: string }
  /** Derive the SRP password input. The other half of a login's two derivations. */
  | { id: number; kind: "deriveSrpPassword"; password: string; srpSaltB64: string }
  | { id: number; kind: "generateSalt" }
  /** Create a vault key for a NEW vault. Returns a ref, never the key. */
  | { id: number; kind: "createVaultKey" }
  /** Wrap a vault key under the master key, for `vault_members.encrypted_vault_key`. */
  | { id: number; kind: "wrapVaultKey"; vaultKey: VaultKeyRef }
  /** Recover a vault key from the server's wrapped copy. Returns a ref. */
  | { id: number; kind: "unwrapVaultKey"; wrapped: Uint8Array }
  | {
      id: number;
      kind: "encryptVault";
      plaintext: Uint8Array;
      vaultKey: VaultKeyRef;
      vaultId: string;
      /** The version the SERVER will assign — `base_version + 1` on a push. */
      version: number;
    }
  | {
      id: number;
      kind: "decryptVault";
      blob: Uint8Array;
      vaultKey: VaultKeyRef;
      vaultId: string;
      /** The version this blob was fetched at. Not "latest" resolved separately. */
      version: number;
    }
  // ─── Registration ──────────────────────────────────────────────────────────
  /**
   * Compute the SRP verifier.
   *
   * `email` is the SRP **identity**, mixed into the verifier — so it must be
   * normalised identically here and at login. The server lowercases it, so send
   * a trimmed, lowercased address or login will fail looking like a bad password.
   */
  | {
      id: number;
      kind: "computeVerifier";
      email: string;
      srpPasswordB64: string;
      srpSaltB64: string;
    }
  | { id: number; kind: "generateKeypair" }
  | { id: number; kind: "keypairPublicKeys"; keypair: KeypairRef }
  /** Seal the private key under the master key. Base64, for the wire. */
  | { id: number; kind: "encryptPrivateKey"; keypair: KeypairRef }

  // ─── Login ─────────────────────────────────────────────────────────────────
  | { id: number; kind: "generateClientEphemeral" }
  | { id: number; kind: "ephemeralPublicA"; ephemeral: SrpEphemeralRef }
  | {
      id: number;
      kind: "computeClientProof";
      email: string;
      srpPasswordB64: string;
      srpSaltB64: string;
      serverPublicBHex: string;
      ephemeral: SrpEphemeralRef;
    }
  | { id: number; kind: "clientProof"; proof: SrpProofRef }
  /** Verify the server's `M2`. Throws if the server cannot prove itself. */
  | { id: number; kind: "verifyServerProof"; serverProofHex: string; proof: SrpProofRef }
  /** Recover the keypair from `GET /auth/me`. Fails when the password is wrong. */
  | { id: number; kind: "decryptPrivateKey"; encryptedB64: string }

  /** Zeroize everything. Called on logout and on tab close. */
  | { id: number; kind: "clear" };

export type CryptoResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/**
 * Errors from the crypto layer.
 *
 * Decryption failure is deliberately indistinguishable between a wrong key, a
 * tampered blob and a mismatched version — the Rust side refuses to say which,
 * and this type does not invent the distinction.
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}
