import type { HttpPort } from "@recipe-vault/core";

/**
 * Core's network capability backed by the platform `fetch`. The plugin's
 * version wraps Obsidian's `requestUrl`; this one runs on the Worker.
 *
 * Worker egress comes from Cloudflare IPs, which some blogs block the same
 * way they block Obsidian mobile — so callers should leave `proxyFallback`
 * on here (see docs/web-app-plan.md 2c).
 */
export const workerHttpPort: HttpPort = {
  get: async (url, headers) => {
    const res = await fetch(url, { method: "GET", headers });
    const text = await res.text();
    if (!res.ok) {
      // Core's fetch loop treats a throw as "this source failed, try the
      // next one", which is what a 403 from the origin should do.
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return { status: res.status, text };
  },
};
