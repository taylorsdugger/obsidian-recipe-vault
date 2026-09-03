/** Thin wrapper over fetch for the JSON API. Throws on a non-2xx body. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  session: () => request<{ signedIn: boolean }>("/session"),
  login: (passcode: string) =>
    request<{ signedIn: boolean }>("/login", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    }),
  logout: () => request<{ signedIn: boolean }>("/logout", { method: "POST" }),
};
