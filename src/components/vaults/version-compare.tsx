/**
 * Comparing versions by key name.
 *
 * ─── Names only, by construction ─────────────────────────────────────────────
 *
 * The server holds each version's key *names* (`key_names`) and never a value,
 * so this can say which keys appeared or disappeared and nothing about a value
 * that changed under the same name. Telling those apart needs both versions
 * decrypted, which is what Open is for — nothing here decrypts or fetches a
 * blob, and the page says so rather than letting "no changes" read as "identical".
 */

"use client";

import { useState } from "react";
import type { VersionMeta } from "@/lib/api/vaults";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type KeyDiff = {
  added: string[];
  removed: string[];
  unchanged: number;
};

/** Key names in `to` but not `from` (added), and the reverse (removed). */
export function diffKeyNames(from: VersionMeta, to: VersionMeta): KeyDiff {
  const before = new Set(from.key_names);
  const after = new Set(to.key_names);
  return {
    added: [...after].filter((k) => !before.has(k)).sort(),
    removed: [...before].filter((k) => !after.has(k)).sort(),
    unchanged: [...after].filter((k) => before.has(k)).length,
  };
}

export function KeyDiffView({ diff }: { diff: KeyDiff }) {
  return (
    <div className="space-y-2 text-xs">
      {diff.added.length === 0 && diff.removed.length === 0 ? (
        <p className="text-muted-foreground">No keys added or removed.</p>
      ) : (
        <ul className="space-y-0.5 font-mono">
          {diff.added.map((k) => (
            <li key={`+${k}`} className="break-all">
              <span className="mr-2 text-green-600 dark:text-green-400">+</span>
              {k}
            </li>
          ))}
          {diff.removed.map((k) => (
            <li key={`-${k}`} className="break-all">
              <span className="mr-2 text-destructive">−</span>
              {k}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        {diff.unchanged} key{diff.unchanged === 1 ? "" : "s"} unchanged by name.
        A changed <em className="not-italic">value</em> can&apos;t be seen here —
        the server only has key names. Open both versions to compare values.
      </p>
    </div>
  );
}

/** Any two versions, newest against the one before it to start. */
export function CompareVersions({ versions }: { versions: VersionMeta[] }) {
  // Newest first, whatever order the server answered in.
  const sorted = [...versions].sort((a, b) => b.version_num - a.version_num);
  const [fromNum, setFromNum] = useState<number | null>(null);
  const [toNum, setToNum] = useState<number | null>(null);

  if (sorted.length < 2) return null;

  const to = sorted.find((v) => v.version_num === toNum) ?? sorted[0];
  const from = sorted.find((v) => v.version_num === fromNum) ?? sorted[1];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare versions</CardTitle>
        <CardDescription>
          Which key names differ between any two versions. Nothing is decrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="compare-from">From</label>
          <VersionSelect
            id="compare-from"
            versions={sorted}
            value={from.version_num}
            onChange={setFromNum}
          />
          <label htmlFor="compare-to">to</label>
          <VersionSelect
            id="compare-to"
            versions={sorted}
            value={to.version_num}
            onChange={setToNum}
          />
        </div>
        {from.version_num === to.version_num ? (
          <p className="text-sm text-muted-foreground">
            Pick two different versions.
          </p>
        ) : (
          <KeyDiffView diff={diffKeyNames(from, to)} />
        )}
      </CardContent>
    </Card>
  );
}

function VersionSelect({
  id,
  versions,
  value,
  onChange,
}: {
  id: string;
  versions: VersionMeta[];
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
    >
      {versions.map((v) => (
        <option key={v.version_num} value={v.version_num}>
          v{v.version_num}
        </option>
      ))}
    </select>
  );
}
