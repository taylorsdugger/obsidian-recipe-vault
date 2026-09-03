import { useState } from "preact/hooks";

import { api } from "../api";

/** One household, one passcode. No accounts (locked decision 3). */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(passcode);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex h-full items-center justify-center p-6">
      <form class="w-full max-w-xs space-y-4" onSubmit={submit}>
        <h1 class="text-center text-2xl font-semibold">Recipe Vault</h1>
        <input
          class="w-full rounded-lg border border-neutral-300 bg-white px-4 py-3 text-center text-lg tracking-widest"
          type="password"
          inputMode="numeric"
          autocomplete="current-password"
          placeholder="Passcode"
          value={passcode}
          onInput={(e) => setPasscode((e.target as HTMLInputElement).value)}
        />
        {error && <p class="text-center text-sm text-red-600">{error}</p>}
        <button
          class="w-full rounded-lg bg-neutral-900 py-3 font-medium text-white disabled:opacity-50"
          type="submit"
          disabled={busy || passcode.length === 0}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
