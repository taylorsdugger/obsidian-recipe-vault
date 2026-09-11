import { useState } from "preact/hooks";

import { api } from "../api";

/** One household, one password. No accounts (locked decision 3). */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
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
          class="field min-h-12"
          type="password"
          autocomplete="current-password"
          placeholder="Password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
        {error && <p class="text-center text-sm text-red-700">{error}</p>}
        <button
          class="btn-primary min-h-12 w-full"
          type="submit"
          disabled={busy || password.length === 0}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
