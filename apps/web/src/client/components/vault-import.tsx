import { useEffect, useState } from "preact/hooks";

import { api } from "../api";
import { lastSyncAt, syncFromVault } from "../sync";

/**
 * The manual sync, and the fallback when the automatic one hasn't run or
 * hasn't picked something up.
 *
 * The app syncs itself on open and when it comes back to the foreground, so
 * most of the time this button has nothing to do. It exists for the case where
 * you've just saved a note in Obsidian, watched Remotely Save push it, and
 * don't want to wait for the app to notice on its own.
 */
export function VaultImport() {
  const [status, setStatus] = useState<{
    notes: number;
    alreadyImported: number;
  } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [syncedAt, setSyncedAt] = useState(lastSyncAt());

  useEffect(() => {
    api
      .vaultStatus()
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, [syncedAt]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setProgress(null);
    try {
      const res = await syncFromVault(true);
      setProgress(
        res.changed
          ? `${res.added} added, ${res.updated} updated` +
              (res.removed > 0 ? `, ${res.removed} removed` : "") +
              "."
          : "Already up to date.",
      );
      setSyncedAt(lastSyncAt());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (error) return <p class="text-sm text-red-600">{error}</p>;
  if (!status) return null;

  return (
    <div class="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 class="font-medium">From the vault</h2>
      <p class="text-sm text-neutral-500">
        {status.notes} recipes in the vault. The app syncs when you open it, so
        this is only needed if you've just changed something in Obsidian.
      </p>
      <button
        type="button"
        class="w-full rounded-lg bg-neutral-200 py-2 disabled:opacity-50"
        disabled={running}
        onClick={run}
      >
        {running ? "Syncing…" : "Sync now"}
      </button>
      {progress && <p class="text-sm text-neutral-500">{progress}</p>}
      {!progress && syncedAt > 0 && (
        <p class="text-sm text-neutral-400">
          Last synced {new Date(syncedAt).toLocaleTimeString()}.
        </p>
      )}
    </div>
  );
}
