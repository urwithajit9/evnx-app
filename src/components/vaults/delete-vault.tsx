"use client";

/**
 * Delete a vault, from the browser.
 *
 * The server has had `DELETE /vaults/:id` since before the dashboard existed and
 * the CLI has had `evnx vault delete` just as long. The app had neither, so the one
 * surface aimed at people who do not want a CLI was the one surface that could not
 * finish the job.
 *
 * # Owner only, and the form is absent rather than disabled
 *
 * The server guards this with `OwnerOnly`. An admin may share, revoke and re-key;
 * destroying the vault stays with the account that created it. A disabled button
 * would invite a click and explain nothing, so an admin sees a sentence instead.
 *
 * # Typing the name is not ceremony
 *
 * The same reasoning as account deletion: a confirm dialog is dismissed
 * reflexively, a typed name is not. This is the one action here that cannot be
 * undone from the UI, and it takes every other member's access with it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteVault } from "@/lib/api/vaults";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteVault({
  vaultId,
  vaultName,
  isOwner,
  memberCount,
}: {
  vaultId: string;
  /** `name/environment`, exactly as the page shows it and the CLI accepts it. */
  vaultName: string;
  isOwner: boolean;
  /** Everyone with access, including you. */
  memberCount: number;
}) {
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => deleteVault(vaultId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["vaults"] });
      router.push("/vaults");
    },
  });

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Delete this vault</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Only the vault&apos;s owner can delete it. You can share, change roles
            and revoke access here, but deleting takes away everyone
            else&apos;s access too, so it stays with the account that created the
            vault.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Compared verbatim. Trimmed only, so a trailing space from a paste is
  // forgiven while a wrong name is not.
  const matches = typed.trim() === vaultName;
  const others = Math.max(0, memberCount - 1);

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Delete this vault</CardTitle>
        <CardDescription>
          Every version in it goes too. This cannot be undone from here.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ⚠️ Named, not implied. Deleting a shared vault removes other people's
            access without asking them, and the number is the part someone is
            most likely to have forgotten. */}
        {others > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {others === 1
                ? "One other person has access to this vault. Deleting it removes their access as well, and they are not asked."
                : `${others} other people have access to this vault. Deleting it removes their access as well, and they are not asked.`}
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertDescription className="text-sm">
            Your local <span className="font-mono">.env</span> files are not
            touched — this deletes what is stored in evnx cloud. If this vault is
            the only copy of a secret, pull it before deleting.
          </AlertDescription>
        </Alert>

        {remove.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {remove.error instanceof Error
                ? remove.error.message
                : "The vault could not be deleted."}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="confirm-vault">
            Type <span className="font-mono">{vaultName}</span> to confirm
          </Label>
          <Input
            id="confirm-vault"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={remove.isPending}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <Button
          variant="destructive"
          disabled={!matches || remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? "Deleting…" : "Delete this vault"}
        </Button>
      </CardContent>
    </Card>
  );
}
