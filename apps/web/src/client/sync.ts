import { api } from "./api";

/**
 * Pulling the vault into the app.
 *
 * There's no push from R2 - no cron, no queue - so the app syncs itself when
 * it opens and when it comes back to the foreground. A sync with nothing to do
 * is one request and a few hundred milliseconds, because the bucket listing
 * carries each note's etag and anything matching the index is skipped without
 * being read.
 */

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  /** True when the index actually moved, so screens know to refetch. */
  changed: boolean;
}

/** Fired after a sync that changed something. Screens listen and refetch. */
export const SYNCED_EVENT = "vault-synced";

/** Don't sync again within this window when the app is brought forward. */
const MIN_GAP_MS = 2 * 60 * 1000;

let running: Promise<SyncResult> | null = null;
let lastRunAt = 0;

/** When the last sync finished, for the manual panel to show. */
export function lastSyncAt(): number {
  return lastRunAt;
}

async function runSync(): Promise<SyncResult> {
  let offset = 0;
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (;;) {
    const res = await api.vaultImport(offset);
    added += res.added;
    updated += res.updated;
    removed += res.removed;
    if (res.nextOffset === null) break;
    offset = res.nextOffset;
  }

  lastRunAt = Date.now();
  const changed = added + updated + removed > 0;
  if (changed) window.dispatchEvent(new CustomEvent(SYNCED_EVENT));
  return { added, updated, removed, changed };
}

/**
 * Sync, unless one is already in flight - two screens mounting at once should
 * make one request, not two. `force` is the manual button, which ignores the
 * throttle because pressing it means "now".
 */
export function syncFromVault(force = false): Promise<SyncResult> {
  if (running) return running;
  if (!force && Date.now() - lastRunAt < MIN_GAP_MS) {
    return Promise.resolve({ added: 0, updated: 0, removed: 0, changed: false });
  }

  running = runSync().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Sync on open, and again when the app is brought back to the foreground. An
 * installed PWA isn't reloaded when you switch back to it, so without the
 * visibility hook a phone left in a pocket would show yesterday's vault.
 */
export function startAutoSync(): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncFromVault();
  };

  void syncFromVault(true);
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
