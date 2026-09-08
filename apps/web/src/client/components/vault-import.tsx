import { useEffect, useState } from "preact/hooks";

import { api } from "../api";

/**
 * Pull the recipes out of the synced Obsidian vault.
 *
 * The notes are already in this app's own format, so there's nothing to parse
 * and nothing to lose: the markdown goes in as written, and `times_made` and
 * `last_made` come with it. Running it again updates what it imported before
 * rather than making a second copy, so it doubles as a re-sync.
 */
export function VaultImport({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<{
    notes: number;
    alreadyImported: number;
  } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api
      .vaultStatus()
      .then(setStatus)
      .catch((err) => setError(err.message));
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    let offset = 0;
    let added = 0;
    let updated = 0;
    let skipped = 0;

    try {
      for (;;) {
        const res = await api.vaultImport(offset);
        added += res.added;
        updated += res.updated;
        skipped += res.skipped;
        setProgress(`${res.processed} of ${res.total}…`);
        if (res.nextOffset === null) break;
        offset = res.nextOffset;
      }
      setProgress(
        `Done. ${added} added, ${updated} updated` +
          (skipped > 0 ? `, ${skipped} skipped` : "") +
          ".",
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (error) {
    return <p class="text-sm text-red-600">{error}</p>;
  }
  if (!status) return null;

  const remaining = status.notes - status.alreadyImported;

  return (
    <div class="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
      <h2 class="font-medium">From the vault</h2>
      <p class="text-sm text-neutral-500">
        {status.notes} notes in the synced vault
        {status.alreadyImported > 0 &&
          `, ${status.alreadyImported} already here`}
        .
      </p>
      <button
        type="button"
        class="w-full rounded-lg bg-neutral-900 py-2 text-white disabled:opacity-50"
        disabled={running || status.notes === 0}
        onClick={run}
      >
        {running
          ? "Importing…"
          : remaining > 0
            ? `Import ${remaining}`
            : "Re-sync from the vault"}
      </button>
      {progress && <p class="text-sm text-neutral-500">{progress}</p>}
    </div>
  );
}
