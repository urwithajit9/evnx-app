/**
 * The crypto Worker. Every Argon2id derivation and every vault operation runs here.
 *
 * ─── Why a Worker is mandatory, not a nicety ─────────────────────────────────
 *
 * Argon2id is memory-hard by design: 64 MiB, t=3, p=4. Measured in Chromium on a
 * sixteen-core desktop it takes **≈148 ms**, and a login runs it **twice** — once
 * for the SRP proof, once to unwrap the keypair — so ≈296 ms of solid CPU.
 *
 * On the main thread that is a third of a second of dropped frames. In a Worker
 * the main thread is untouched: measured worst event-loop gap during a full
 * derivation was 5.3 ms, against 5.5 ms while idle.
 *
 * (Measure with the tab VISIBLE. A hidden tab is throttled and reports roughly
 * 3× these times — which is exactly the mistake that produced this file's first
 * set of numbers.)
 *
 * ─── Why keys never leave ────────────────────────────────────────────────────
 *
 * Handles stay in this scope. JavaScript values live in a garbage-collected heap
 * with no `ZeroizeOnDrop` equivalent: the engine may copy a buffer while
 * compacting, and nothing says when the original is released. The Rust side keeps
 * the bytes under `Zeroizing` and hands out opaque handles, and this file is what
 * preserves that boundary on the JS side.
 */

import init, {
  deriveMasterKey,
  deriveSrpPassword,
  generateSalt,
  createVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  encryptVault,
  decryptVault,
  blobHash,
  computeVerifier,
  generateClientEphemeral,
  computeClientProof,
  verifyServerProof,
  generateKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
  type MasterKeyHandle,
  type VaultKeyHandle,
  type SrpEphemeralHandle,
  type SrpProofHandle,
  type KeypairHandle,
} from "@evnx/crypto-wasm";

import type {
  CryptoRequest,
  CryptoResponse,
  VaultKeyRef,
  SrpEphemeralRef,
  SrpProofRef,
  KeypairRef,
} from "./protocol";

let ready: Promise<unknown> | null = null;

/** The one master key for this session. Never serialised, never posted out. */
let masterKey: MasterKeyHandle | null = null;

/** Vault keys by opaque ref. The main thread holds only the ref strings. */
const vaultKeys = new Map<VaultKeyRef, VaultKeyHandle>();

/**
 * Transient auth state, held for the duration of one register or login.
 *
 * All three carry private material under `ZeroizeOnDrop` on the Rust side, so
 * they live here as handles for the same reason vault keys do.
 */
const ephemerals = new Map<SrpEphemeralRef, SrpEphemeralHandle>();
const proofs = new Map<SrpProofRef, SrpProofHandle>();
const keypairs = new Map<KeypairRef, KeypairHandle>();

let refCounter = 0;

function ensureInit() {
  // `init()` is idempotent in practice, but a single shared promise means
  // concurrent messages arriving before the wasm is up all await the same load
  // rather than racing several fetches of the same module.
  ready ??= init();
  return ready;
}

function requireMasterKey(): MasterKeyHandle {
  if (!masterKey) {
    // Reached when the tab was reopened, or after logout. The UI must send the
    // user back to sign in — there is nothing to recover from here.
    throw new Error("locked: no master key in memory");
  }
  return masterKey;
}

function requireVaultKey(ref: VaultKeyRef): VaultKeyHandle {
  const vk = vaultKeys.get(ref);
  if (!vk) throw new Error(`unknown vault key ref: ${ref}`);
  return vk;
}

function storeVaultKey(vk: VaultKeyHandle): VaultKeyRef {
  const ref = `vk_${++refCounter}`;
  vaultKeys.set(ref, vk);
  return ref;
}

function requireRef<T>(map: Map<string, T>, ref: string, what: string): T {
  const v = map.get(ref);
  if (!v) throw new Error(`unknown ${what} ref: ${ref}`);
  return v;
}

/** Zeroize everything now, rather than waiting for GC to get round to it. */
function clearAll() {
  masterKey?.destroy();
  masterKey = null;
  for (const vk of vaultKeys.values()) vk.destroy();
  vaultKeys.clear();
  clearSrpState();
  for (const k of keypairs.values()) k.destroy();
  keypairs.clear();
}

/**
 * Drop the SRP ephemerals and proofs.
 *
 * Separate from the keypairs on purpose. This runs at the end of **every** login
 * attempt — an ephemeral is single-use, and one kept past its exchange is the
 * sort of thing that gets reused by accident later, which weakens the exchange.
 * The keypair recovered during that same login has to survive it, so lumping the
 * two together (as an earlier revision did) would have destroyed the user's
 * identity key the moment they signed in.
 */
function clearSrpState() {
  for (const e of ephemerals.values()) e.destroy();
  ephemerals.clear();
  for (const p of proofs.values()) p.destroy();
  proofs.clear();
}

async function handle(req: CryptoRequest): Promise<unknown> {
  await ensureInit();

  switch (req.kind) {
    case "init":
      return { ready: true };

    case "deriveMasterKey": {
      // Replacing an existing key must free the old one first, or a re-login
      // leaves the previous master key sitting in wasm memory until GC.
      masterKey?.destroy();
      masterKey = deriveMasterKey(req.password, req.argon2SaltB64);
      return { derived: true };
    }

    case "deriveSrpPassword":
      // Leaves the Worker by necessity: it is an input to the SRP exchange, not
      // a stored key. Still password-equivalent — the caller uses it for the
      // proof and drops the reference.
      return deriveSrpPassword(req.password, req.srpSaltB64);

    case "generateSalt":
      return generateSalt();

    case "createVaultKey":
      return storeVaultKey(createVaultKey());

    case "wrapVaultKey":
      return wrapVaultKey(requireVaultKey(req.vaultKey), requireMasterKey());

    case "unwrapVaultKey":
      return storeVaultKey(unwrapVaultKey(req.wrapped, requireMasterKey()));

    case "encryptVault":
      return encryptVault(
        req.plaintext,
        requireVaultKey(req.vaultKey),
        req.vaultId,
        req.version,
      );

    case "decryptVault":
      // Fails identically for a wrong key, a tampered blob and a mismatched
      // version. That is deliberate on the Rust side; do not try to distinguish.
      return decryptVault(
        req.blob,
        requireVaultKey(req.vaultKey),
        req.vaultId,
        req.version,
      );

    case "sealForPush": {
      const blob = encryptVault(
        req.plaintext,
        requireVaultKey(req.vaultKey),
        req.vaultId,
        req.version,
      );
      // `encryptVault` returns nonce || ciphertext. The wire wants them apart,
      // and the hash covers only the second half.
      const nonce = blob.slice(0, 12);
      const ciphertext = blob.slice(12);
      return { nonce, ciphertext, blobHash: blobHash(ciphertext) };
    }

    // ─── Registration ────────────────────────────────────────────────────
    case "computeVerifier": {
      const v = computeVerifier(req.email, req.srpPasswordB64, req.srpSaltB64);
      return { verifier: v.verifier, srpSalt: v.srpSalt };
    }

    case "generateKeypair": {
      const ref = `kp_${++refCounter}`;
      keypairs.set(ref, generateKeypair());
      return ref;
    }

    case "keypairPublicKeys": {
      const kp = requireRef(keypairs, req.keypair, "keypair");
      return { ed25519: kp.ed25519PublicKey(), x25519: kp.x25519PublicKey() };
    }

    case "encryptPrivateKey":
      return encryptPrivateKey(
        requireRef(keypairs, req.keypair, "keypair"),
        requireMasterKey(),
      );

    // ─── Login ───────────────────────────────────────────────────────────
    case "generateClientEphemeral": {
      const ref = `eph_${++refCounter}`;
      ephemerals.set(ref, generateClientEphemeral());
      return ref;
    }

    case "ephemeralPublicA":
      return requireRef(ephemerals, req.ephemeral, "ephemeral").publicA();

    case "computeClientProof": {
      const ref = `proof_${++refCounter}`;
      proofs.set(
        ref,
        computeClientProof(
          req.email,
          req.srpPasswordB64,
          req.srpSaltB64,
          req.serverPublicBHex,
          requireRef(ephemerals, req.ephemeral, "ephemeral"),
        ),
      );
      return ref;
    }

    case "clientProof":
      return requireRef(proofs, req.proof, "proof").clientProof();

    case "verifyServerProof": {
      // Throws when the server cannot prove it holds the verifier. Let it
      // propagate: a caller that swallows this has given up the guarantee.
      verifyServerProof(req.serverProofHex, requireRef(proofs, req.proof, "proof"));
      return { verified: true };
    }

    case "decryptPrivateKey": {
      const ref = `kp_${++refCounter}`;
      keypairs.set(ref, decryptPrivateKey(req.encryptedB64, requireMasterKey()));
      return ref;
    }

    case "clearSrpState":
      clearSrpState();
      return { cleared: true };

    case "clear":
      clearAll();
      return { cleared: true };
  }
}

self.onmessage = async (e: MessageEvent<CryptoRequest>) => {
  const req = e.data;
  try {
    const result = await handle(req);
    self.postMessage({ id: req.id, ok: true, result } satisfies CryptoResponse);
  } catch (err) {
    // Only the message crosses back, never the error object: a structured-clone
    // of a wasm error can drag its internals along with it.
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies CryptoResponse);
  }
};
