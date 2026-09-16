/**
 * Auth self-test — the real register and login flows against a real server.
 *
 * Not a product page. The crypto self-test at `/selftest/` proves the wasm works;
 * this proves the *protocol* works, which is a different and easier thing to get
 * wrong. Every failure mode it covers produces the same symptom in the UI — "that
 * password is wrong" — for a password that is perfectly correct:
 *
 *   * the email not normalised identically at register and login, so the SRP
 *     identity differs and the proof is computed over the wrong string;
 *   * a field sent hex that should be base64, or the reverse;
 *   * `argon2_salt` taken from `srp/init` (which fabricates one for unknown
 *     addresses) instead of from the authenticated `/auth/me`.
 *
 * It also includes the **negative control** that keeps the M2 check honest. A
 * `verifyServerProof` that accepted anything would let all the positive tests
 * pass, so this one corrupts a genuine proof and requires the rejection.
 *
 * Point `NEXT_PUBLIC_API_URL` at a server you are willing to create accounts on.
 * Each run registers one throwaway account.
 */

"use client";

import { useState } from "react";
import { register } from "@/lib/auth/register";
import { login, completeSecondFactor, ServerProofError } from "@/lib/auth/login";
import {
  clearSrpState,
  computeClientProof,
  clientProof,
  deriveSrpPassword,
  ephemeralPublicA,
  generateClientEphemeral,
  verifyServerProof,
  clearKeys,
} from "@/lib/crypto/client";
import { postSrpInit, postSrpVerify } from "@/lib/api/auth";
import { API_URL, hasSession } from "@/lib/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useKeyStore } from "@/stores/keyStore";
import { normalizeEmail } from "@/lib/auth/credentials";

type Row = { label: string; value: string; ok?: boolean };

/** A password that clears the 12-character floor without being guessable. */
const PASSWORD = "correct horse battery staple 7";

export default function AuthSelfTest() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRows([]);
    setRunning(true);

    // Accumulate locally as well as in state: `rows` captured in this closure is
    // the render-time snapshot and never sees these pushes, so counting failures
    // off it would always report zero.
    const log: Row[] = [];
    const push = (r: Row) => {
      log.push(r);
      setRows([...log]);
    };

    // A fresh address per run. Deliberately mixed-case with surrounding space:
    // if normalisation is wrong anywhere, register and login disagree and step 3
    // fails — which is the single most likely way to break this flow.
    const suffix = crypto.randomUUID().slice(0, 8);
    const rawEmail = `  SelfTest-${suffix}@Example.COM `;

    try {
      push({ label: "api", value: API_URL });
      push({ label: "email (as typed)", value: JSON.stringify(rawEmail) });
      push({ label: "email (normalised)", value: normalizeEmail(rawEmail) });

      // ── 1. Register ────────────────────────────────────────────────────────
      const t0 = performance.now();
      const reg = await register({
        email: rawEmail,
        password: PASSWORD,
        onProgress: (s) => push({ label: "register", value: s }),
      });
      push({
        label: "1. register",
        value: `user_id ${reg.user_id} · ${(performance.now() - t0).toFixed(0)} ms`,
        ok: true,
      });

      // ── 2. Register leaves no session ──────────────────────────────────────
      push({
        label: "2. no session after register",
        value: hasSession() ? "FAIL — a token was set" : "no token, as the CLI does",
        ok: !hasSession(),
      });

      // ── 3. Log in ──────────────────────────────────────────────────────────
      const t1 = performance.now();
      const result = await login({
        email: rawEmail,
        password: PASSWORD,
        onProgress: (s) => push({ label: "login", value: s }),
      });
      const loginMs = performance.now() - t1;

      if (result.status === "totp-required") {
        // A brand-new account cannot have TOTP enabled, so reaching this means
        // the server took a branch it should not have.
        push({
          label: "3. login",
          value: "FAIL — a new account asked for a second factor",
          ok: false,
        });
        void completeSecondFactor; // referenced so the import documents the branch
        return;
      }

      push({
        label: "3. login",
        value: `signed in as ${result.me.email} · ${loginMs.toFixed(0)} ms (2× Argon2id + 3 round trips)`,
        ok: true,
      });

      // ── 4. The account is genuinely the one just created ───────────────────
      const emailMatches = result.me.email === normalizeEmail(rawEmail);
      push({
        label: "4. identity round-trips",
        value: emailMatches
          ? `${result.me.email} — server stored the normalised form`
          : `FAIL — server has ${result.me.email}`,
        ok: emailMatches,
      });
      push({
        label: "5. email_verified",
        value: `${result.me.email_verified} — /auth/me works unverified, which is what lets a first login happen at all`,
        ok: result.me.email_verified === false,
      });

      // ── 6. The stores agree the session is usable ─────────────────────────
      useAuthStore.getState().signedIn(result.me, result.backupCodesRemaining);
      const unlocked = useKeyStore.getState().unlocked;
      push({
        label: "6. key store unlocked",
        value: unlocked ? "master key + keypair are in the Worker" : "FAIL",
        ok: unlocked,
      });

      // ── 7. Negative: a wrong password must not sign in ─────────────────────
      let wrongRejected = false;
      try {
        await login({ email: rawEmail, password: `${PASSWORD} not really` });
      } catch {
        wrongRejected = true;
      }
      push({
        label: "7. wrong password rejected",
        value: wrongRejected ? "SRP refused it" : "FAIL — a wrong password signed in",
        ok: wrongRejected,
      });

      // ── 8. Negative control: the M2 check must actually reject ────────────
      //
      // Without this, a `verifyServerProof` that returned success unconditionally
      // would pass every test above. Corrupt one nibble of a genuine proof and
      // require the failure.
      const tampered = await m2RejectsTampering(rawEmail);
      push({
        label: "8. tampered M2 rejected",
        value: tampered
          ? "a one-nibble change to the server proof fails the login"
          : "FAIL — the mutual-authentication half of SRP is not being enforced",
        ok: tampered,
      });

      const failures = log.filter((r) => r.ok === false).length;
      push({
        label: "result",
        value: failures === 0 ? "all checks passed" : `${failures} check(s) failed`,
        ok: failures === 0,
      });
    } catch (e) {
      push({
        label: "error",
        value: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        ok: false,
      });
    } finally {
      await clearKeys().catch(() => {});
      setRunning(false);
    }
  }

  return (
    <main style={{ font: "14px/1.6 ui-monospace, monospace", padding: 24, maxWidth: 900 }}>
      <h1 style={{ font: "600 18px/1.4 ui-sans-serif, system-ui" }}>evnx auth self-test</h1>
      <p style={{ color: "#666", maxWidth: 60 + "ch" }}>
        Registers a throwaway account and signs into it, against{" "}
        <code>{API_URL}</code>. Run this with the tab <strong>visible</strong> —
        a hidden tab is throttled roughly 3× and the timings are meaningless.
      </p>
      <button
        onClick={run}
        disabled={running}
        style={{ padding: "8px 16px", margin: "12px 0", cursor: running ? "wait" : "pointer" }}
      >
        {running ? "running…" : "Run"}
      </button>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "4px 12px 4px 0", color: "#666", whiteSpace: "nowrap", verticalAlign: "top" }}>
                {r.label}
              </td>
              <td style={{ padding: "4px 0", color: r.ok === false ? "#b00" : undefined }}>
                {r.ok === true ? "✓ " : r.ok === false ? "✗ " : ""}
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

/**
 * Drive SRP by hand as far as `M2`, then corrupt it and require a rejection.
 *
 * The account does not need to exist: `srp/init` answers unknown addresses with
 * a fabricated salt precisely so it cannot be used to enumerate, and the server
 * still returns a `server_proof` shaped value. All this needs is a well-formed
 * proof to damage.
 */
async function m2RejectsTampering(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  try {
    const ephemeral = await generateClientEphemeral();
    const init = await postSrpInit(normalized, await ephemeralPublicA(ephemeral));
    const srpPasswordB64 = await deriveSrpPassword(PASSWORD, init.srp_salt);
    const proof = await computeClientProof(
      normalized,
      srpPasswordB64,
      init.srp_salt,
      init.server_public,
      ephemeral,
    );
    const verify = await postSrpVerify(init.session_id, await clientProof(proof));

    // Flip the first hex digit. Any single-nibble change is enough — M2 is a
    // hash, so there is no "close enough".
    const first = verify.server_proof[0];
    const flipped = (first === "0" ? "1" : "0") + verify.server_proof.slice(1);

    try {
      await verifyServerProof(flipped, proof);
      return false; // accepted a corrupted proof — the check is not doing its job
    } catch {
      return true;
    }
  } catch (e) {
    // A ServerProofError from the helper's own login would be a different bug;
    // anything else here (network, 401) means the control did not run.
    return e instanceof ServerProofError;
  } finally {
    await clearSrpState().catch(() => {});
  }
}
