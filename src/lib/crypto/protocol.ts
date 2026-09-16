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
