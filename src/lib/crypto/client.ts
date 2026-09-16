/**
 * Main-thread client for the crypto Worker.
 *
 * Promise-based RPC over `postMessage`. Everything here is a thin wrapper — the
 * actual work, and all the key material, stays on the other side of the boundary.
 */

"use client";

import {
  CryptoError,
  type CryptoRequest,
  type CryptoResponse,
  type VaultKeyRef,
  type SrpEphemeralRef,
  type SrpProofRef,
  type KeypairRef,
  type VerifierBundle,
  type PublicKeys,
} from "./protocol";

/**
 * `Omit<Union, K>` collapses a discriminated union to only the keys every member
 * shares — here just `kind` — so every payload field becomes a type error. The
 * conditional makes it distribute over the union instead, preserving each variant.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (typeof window === "undefined") {
    // Guards against a static-export prerender pass touching this. Nothing on a
    // build server should be constructing a crypto Worker.
    throw new CryptoError("crypto Worker is browser-only");
  }
  if (worker) return worker;

  // `new URL(..., import.meta.url)` is how both Turbopack and webpack recognise a
  // Worker entry point and emit it as a separate chunk. A bare string path would
  // be left as-is and 404 in production.
  worker = new Worker(new URL("./crypto.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e: MessageEvent<CryptoResponse>) => {
    const res = e.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new CryptoError(res.error));
  };

  worker.onerror = (e) => {
    // A Worker that dies takes every in-flight request with it. Failing them all
    // is better than leaving promises that never settle.
    const err = new CryptoError(`crypto Worker failed: ${e.message}`);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    worker = null;
  };

  return worker;
}

function call<T>(req: DistributiveOmit<CryptoRequest, "id">): Promise<T> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...req, id } as CryptoRequest);
  });
}

// ─── Key derivation ──────────────────────────────────────────────────────────

/**
 * Derive and store the master key in the Worker.
 *
 * Costs ~150 ms of CPU on a desktop, more on a phone. Show progress — this is
 * long enough that a UI with no feedback reads as broken.
 */
export function deriveMasterKey(password: string, argon2SaltB64: string) {
  return call<{ derived: boolean }>({
    kind: "deriveMasterKey",
    password,
    argon2SaltB64,
  });
}

/** Derive the SRP password input (base64). The other half of a login. */
export function deriveSrpPassword(password: string, srpSaltB64: string) {
  return call<string>({ kind: "deriveSrpPassword", password, srpSaltB64 });
}

/** A fresh random Argon2id salt, base64. */
export function generateSalt() {
  return call<string>({ kind: "generateSalt" });
}

// ─── Vault keys ──────────────────────────────────────────────────────────────

export function createVaultKey() {
  return call<VaultKeyRef>({ kind: "createVaultKey" });
}

export function wrapVaultKey(vaultKey: VaultKeyRef) {
  return call<Uint8Array>({ kind: "wrapVaultKey", vaultKey });
}

export function unwrapVaultKey(wrapped: Uint8Array) {
  return call<VaultKeyRef>({ kind: "unwrapVaultKey", wrapped });
}

// ─── Blobs ───────────────────────────────────────────────────────────────────

/**
 * Encrypt, sealed to `(vaultId, version)`.
 *
 * `version` must be the number the **server** will assign — `base_version + 1`
 * on a push. Pass the wrong one and the blob is unopenable by anybody.
 */
export function encryptVault(
  plaintext: Uint8Array,
  vaultKey: VaultKeyRef,
  vaultId: string,
  version: number,
) {
  return call<Uint8Array>({
    kind: "encryptVault",
    plaintext,
    vaultKey,
    vaultId,
    version,
  });
}

/**
 * Decrypt a blob sealed at `(vaultId, version)`.
 *
 * Use the version you actually fetched. Resolving "latest" separately races a
 * concurrent push, and the two numbers then disagree and this throws.
 */
export function decryptVault(
  blob: Uint8Array,
  vaultKey: VaultKeyRef,
  vaultId: string,
  version: number,
) {
  return call<Uint8Array>({
    kind: "decryptVault",
    blob,
    vaultKey,
    vaultId,
    version,
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Compute the SRP verifier.
 *
 * Pass a **trimmed, lowercased** email. It is the SRP identity, mixed into the
 * verifier, and the server lowercases it — so a capitalised address here
 * produces a verifier that will not match at login, failing in a way that looks
 * exactly like a wrong password.
 */
export function computeVerifier(
  email: string,
  srpPasswordB64: string,
  srpSaltB64: string,
) {
  return call<VerifierBundle>({
    kind: "computeVerifier",
    email,
    srpPasswordB64,
    srpSaltB64,
  });
}

export function generateKeypair() {
  return call<KeypairRef>({ kind: "generateKeypair" });
}

export function keypairPublicKeys(keypair: KeypairRef) {
  return call<PublicKeys>({ kind: "keypairPublicKeys", keypair });
}

/** Base64 sealed private key, for `encrypted_private_key`. Needs the master key. */
export function encryptPrivateKey(keypair: KeypairRef) {
  return call<string>({ kind: "encryptPrivateKey", keypair });
}

// ─── Login ───────────────────────────────────────────────────────────────────

/** Fresh SRP ephemeral for one login attempt. Never reuse one. */
export function generateClientEphemeral() {
  return call<SrpEphemeralRef>({ kind: "generateClientEphemeral" });
}

/** Hex public `A`, sent as `client_public`. */
export function ephemeralPublicA(ephemeral: SrpEphemeralRef) {
  return call<string>({ kind: "ephemeralPublicA", ephemeral });
}

export function computeClientProof(
  email: string,
  srpPasswordB64: string,
  srpSaltB64: string,
  serverPublicBHex: string,
  ephemeral: SrpEphemeralRef,
) {
  return call<SrpProofRef>({
    kind: "computeClientProof",
    email,
    srpPasswordB64,
    srpSaltB64,
    serverPublicBHex,
    ephemeral,
  });
}

/** Hex `M1`, sent as `client_proof`. */
export function clientProof(proof: SrpProofRef) {
  return call<string>({ kind: "clientProof", proof });
}

/**
 * Verify the server's `M2`. **Rejects** when the server cannot prove it holds
 * your verifier.
 *
 * Never catch-and-continue here. This is the half of SRP that authenticates the
 * *server*; skipping it hands a session to anything sitting in the middle.
 */
export function verifyServerProof(serverProofHex: string, proof: SrpProofRef) {
  return call<{ verified: boolean }>({
    kind: "verifyServerProof",
    serverProofHex,
    proof,
  });
}

/** Recover the keypair. Failure here means the password was wrong. */
export function decryptPrivateKey(encryptedB64: string) {
  return call<KeypairRef>({ kind: "decryptPrivateKey", encryptedB64 });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/** Zeroize every key in the Worker. Call on logout. */
export function clearKeys() {
  return call<{ cleared: boolean }>({ kind: "clear" });
}

/**
 * Tear the Worker down entirely.
 *
 * `clearKeys` zeroizes but keeps the Worker warm; this also drops the wasm
 * instance, so the next call pays the module load again (~88 ms).
 */
export function terminateCrypto() {
  worker?.terminate();
  worker = null;
  pending.clear();
}
