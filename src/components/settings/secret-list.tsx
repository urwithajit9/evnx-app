/**
 * Display for values the server will never show again.
 *
 * Recovery codes and a freshly minted API token exist in a readable form for
 * exactly one response. The server keeps a BLAKE3 hash and cannot reproduce
 * them, so a user who closes this without saving has lost them — recovery codes
 * are then unreissuable without a working authenticator, and an API token has to
 * be revoked and replaced.
 *
 * Which makes the UI's job unusually specific:
 *
 *   * say plainly that this is the only time, before the value scrolls away;
 *   * make saving one action, not ten — hence Copy all and Download;
 *   * require an explicit acknowledgement rather than a dismissible toast.
 *
 * ⚠️ Nothing here may be persisted for convenience. No `localStorage`, no
 * "remember", no query-cache entry that survives the page. The one-shot nature
 * is the security property.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Irreversible } from "@/components/shell/zero-knowledge";

export function SecretList({
  title,
  description,
  values,
  filename,
  onAcknowledge,
}: {
  title: string;
  description: string;
  values: string[];
  filename: string;
  onAcknowledge: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = values.join("\n") + "\n";

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSaved(true);
    } catch {
      // Clipboard access can be refused outright. The values are on screen and
      // selectable, so this is a convenience failing, not the flow failing.
      setCopied(false);
    }
  }

  function download() {
    // A blob URL built and revoked here — the values never reach a server, and
    // nothing is left holding a reference to them afterwards.
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }

  return (
    <div className="space-y-3">
      <Irreversible title={title}>{description}</Irreversible>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted p-3 font-mono text-sm">
        {values.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyAll}>
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button size="sm" variant="outline" onClick={download}>
          Download
        </Button>
        <Button size="sm" onClick={onAcknowledge} disabled={!saved}>
          {saved ? "I have saved these" : "Save them first"}
        </Button>
      </div>
    </div>
  );
}
