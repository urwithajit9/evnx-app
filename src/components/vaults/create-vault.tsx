/**
 * Create-vault form.
 *
 * The 256-bit vault key is generated and wrapped in the Worker before the
 * request is sent — see `lib/vaults/create.ts`.
 */

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createVault, validateVaultName } from "@/lib/vaults/create";
import { apiErrorCode } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function CreateVault() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = name.length > 0 ? validateVaultName(name) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createVault(name, environment);
      await qc.invalidateQueries({ queryKey: ["vaults"] });
      setName("");
      setOpen(false);
    } catch (err) {
      // A conflict on this endpoint can only be the (name, environment) pair —
      // the server enforces uniqueness per owner.
      setError(
        apiErrorCode(err) === "CONFLICT"
          ? `You already have a vault called ${name} in ${environment}.`
          : err instanceof Error
            ? err.message
            : "Could not create the vault.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        New vault
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New vault</CardTitle>
        <CardDescription>
          A fresh 256-bit key is generated here and wrapped under your master
          password before it leaves this browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="vault-name">Name</Label>
            <Input
              id="vault-name"
              required
              autoFocus
              disabled={busy}
              placeholder="my-app"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!nameError}
            />
            <p className="text-xs text-muted-foreground">
              {nameError ?? "Lowercase letters, digits and hyphens."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vault-env">Environment</Label>
            <Input
              id="vault-env"
              required
              disabled={busy}
              placeholder="production"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !!nameError}>
              {busy ? "Creating…" : "Create vault"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
