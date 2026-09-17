/**
 * The enrolment QR code.
 *
 * ─── Why this is generated locally and not by an image service ───────────────
 *
 * The `otpauth://` URI **contains the TOTP secret**. Handing it to
 * `api.qrserver.com`, Google Charts or any other QR-image endpoint — the usual
 * shortcut — sends the second factor for a zero-knowledge vault to a third party
 * in a URL, where it lands in their logs. It would also be a request to an
 * origin the CSP does not allow, so it would fail loudly here; but it must not
 * be "fixed" by loosening the CSP.
 *
 * `qrcode-generator` is pure JavaScript with no dependencies and no network
 * access, so the secret never leaves this tab.
 *
 * The SVG is built from the module matrix by hand rather than through the
 * library's `createSvgTag()`, which returns a string that would have to go
 * through `dangerouslySetInnerHTML`.
 */

"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function TotpQr({ uri, size = 200 }: { uri: string; size?: number }) {
  const { path, count } = useMemo(() => {
    // Type 0 = auto-size for the data. 'M' correction tolerates ~15% damage,
    // which is the level authenticator apps expect.
    const qr = qrcode(0, "M");
    qr.addData(uri);
    qr.make();

    const count = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) path += `M${col},${row}h1v1h-1z`;
      }
    }
    return { path, count };
  }, [uri]);

  return (
    <svg
      // The quiet zone is part of the spec — scanners need ~4 modules of margin
      // and some phones simply fail without it.
      viewBox={`-4 -4 ${count + 8} ${count + 8}`}
      width={size}
      height={size}
      role="img"
      aria-label="Two-factor setup QR code"
      // White ground regardless of theme: a dark-mode inversion makes the code
      // unreadable to many scanners, which assume dark-on-light.
      style={{ background: "#fff", borderRadius: 8, padding: 4 }}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Group a base32 secret into fours, for anyone typing it by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
