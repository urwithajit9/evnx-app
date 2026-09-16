/**
 * Crypto self-test.
 *
 * Not a product page. It exists because the three claims this app rests on are
 * each cheap to get wrong and expensive to discover late:
 *
 *   1. The wasm loads and runs inside a Worker.
 *   2. Argon2id is fast enough here to be usable — measured, not assumed.
 *   3. Associated data behaves: a blob sealed at one version is REJECTED at any
 *      other. Without this the browser silently produces blobs the CLI cannot
 *      open, and nothing fails until the first cross-client pull.
 *
 * Open /selftest/ in a browser — including a phone, which is the case the
 * desktop numbers cannot answer.
 */

"use client";

import { useState } from "react";
import {
  deriveMasterKey,
  deriveSrpPassword,
  generateSalt,
  createVaultKey,
  encryptVault,
  decryptVault,
  clearKeys,
} from "@/lib/crypto/client";

type Row = { label: string; value: string; ok?: boolean };

export default function SelfTest() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const push = (r: Row) => setRows((prev) => [...prev, r]);

  async function run() {
    setRows([]);
    setRunning(true);
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    try {
      push({ label: "userAgent", value: navigator.userAgent });
      push({
        label: "hardwareConcurrency",
        value: String(navigator.hardwareConcurrency ?? "n/a"),
      });

      const t0 = performance.now();
      const salt = await generateSalt();
      push({
        label: "wasm init + generateSalt",
        value: `${(performance.now() - t0).toFixed(0)} ms`,
        ok: true,
      });

      const pw = "correct horse battery staple";

      const t1 = performance.now();
      await deriveMasterKey(pw, salt);
      const mk = performance.now() - t1;
      push({ label: "deriveMasterKey", value: `${mk.toFixed(0)} ms`, ok: true });

      const t2 = performance.now();
      await deriveSrpPassword(pw, salt);
      const sp = performance.now() - t2;
      push({ label: "deriveSrpPassword", value: `${sp.toFixed(0)} ms`, ok: true });

      push({
        label: "LOGIN TOTAL (both derivations)",
        value: `${(mk + sp).toFixed(0)} ms`,
        ok: mk + sp < 3000,
      });

      const vaultId = "6f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
      const vk = await createVaultKey();
      const plaintext = enc.encode("API_KEY=sk-live-example\nDB_URL=postgres://x\n");

      const blob = await encryptVault(plaintext, vk, vaultId, 7);
      push({
        label: "encryptVault @ v7",
        value: `${blob.length} bytes from ${plaintext.length}`,
        ok: true,
      });

      const back = await decryptVault(blob, vk, vaultId, 7);
      push({
        label: "decryptVault @ v7 round trip",
        value: dec.decode(back) === dec.decode(plaintext) ? "identical" : "MISMATCH",
        ok: dec.decode(back) === dec.decode(plaintext),
      });

      // The important half. If this ever succeeds, version binding is broken and
      // a malicious server could replay an old version as current.
      let rejected = false;
      try {
        await decryptVault(blob, vk, vaultId, 8);
      } catch {
        rejected = true;
      }
      push({
        label: "replay @ v8 must be REJECTED",
        value: rejected ? "rejected" : "ACCEPTED — AAD IS BROKEN",
        ok: rejected,
      });

      let wrongVault = false;
      try {
        await decryptVault(blob, vk, "a-different-vault", 7);
      } catch {
        wrongVault = true;
      }
      push({
        label: "wrong vault id must be REJECTED",
        value: wrongVault ? "rejected" : "ACCEPTED — AAD IS BROKEN",
        ok: wrongVault,
      });

      await clearKeys();
      push({ label: "clearKeys", value: "zeroized", ok: true });
    } catch (e) {
      push({
        label: "FAILED",
        value: e instanceof Error ? e.message : String(e),
        ok: false,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8 font-mono text-sm">
      <h1 className="mb-2 text-lg font-bold">evnx crypto self-test</h1>
      <p className="mb-6 text-neutral-500">
        Runs Argon2id and the full vault round trip inside the crypto Worker.
      </p>

      <button
        onClick={run}
        disabled={running}
        className="mb-6 rounded border border-neutral-400 px-4 py-2 disabled:opacity-50"
      >
        {running ? "running…" : "Run self-test"}
      </button>

      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1 pr-4 align-top text-neutral-500">{r.label}</td>
              <td
                className={
                  r.ok === undefined
                    ? "py-1 break-all"
                    : r.ok
                      ? "py-1 break-all text-green-600"
                      : "py-1 break-all font-bold text-red-600"
                }
              >
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
