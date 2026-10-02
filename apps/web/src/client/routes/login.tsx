import { useState } from "preact/hooks";

import { api } from "../api";
import { AppIcon } from "../components/logo";

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
      <form
        class="w-full max-w-xs space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <AppIcon class="mx-auto size-16" />
        <h1 class="title-display text-center">Recipe Vault</h1>
        <input
          class="field-round"
          type="password"
          autocomplete="current-password"
          placeholder="Password"
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
        {error && <p class="text-center text-sm text-danger">{error}</p>}
        <button
          class="btn-primary w-full"
          type="submit"
          disabled={busy || password.length === 0}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
