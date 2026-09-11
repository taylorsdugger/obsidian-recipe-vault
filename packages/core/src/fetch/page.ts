import type { HttpPort } from "./http";

/** Options for {@link fetchPageHtml}. */
export interface FetchPageOptions {
  /** Retry through public read proxies when the direct request is blocked. */
  proxyFallback: boolean;
  /** Base backoff between retries (ms); scaled per attempt. Tests pass 0. */
  retryDelayMs: number;
  /** Called with each user-facing status line (the plugin maps it to Notice). */
  onProgress?: (message: string) => void;
}

/** Promise-based delay used to back off between fetch retries. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PageSource = {
  label: string;
  url: string;
  headers: Record<string, string>;
  /** How many times to try this source before moving to the next. */
  tries: number;
  /** Pull the page HTML out of the (possibly wrapped) response body. */
  unwrap: (body: string) => string;
  /** Direct origin hits are trusted; proxy output must mention the host. */
  trusted: boolean;
};

/**
 * Fetch a page's HTML, retrying and falling back through public read proxies
 * when the direct request is blocked.
 *
 * Obsidian desktop fetches through Chromium's network stack and slips past
 * Cloudflare, but on mobile `requestUrl` uses the native HTTP client whose
 * TLS/HTTP fingerprint Cloudflare flags as a bot — so direct fetches there
 * 403 no matter what `User-Agent` we send. When the proxy fallback is enabled
 * we retry through server-side readers that fetch the page for us: jina.ai
 * first (reliable, returns raw HTML), then allorigins (free but flaky, so it
 * gets retried). Each non-direct source must echo back the target host, so a
 * proxy's own error/landing page is never mistaken for the recipe.
 */
export async function fetchPageHtml(
  fetchUrl: URL,
  http: HttpPort,
  opts: FetchPageOptions,
): Promise<string> {
  const progress = (message: string): void => opts.onProgress?.(message);

  progress(`Fetching: ${fetchUrl.href}`);

  const reqHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const target = fetchUrl.href;
  const host = fetchUrl.hostname.replace(/^www\./, "");

  const sources: PageSource[] = [
    {
      label: "direct",
      url: target,
      headers: reqHeaders,
      tries: 1,
      unwrap: (body) => body,
      trusted: true,
    },
  ];

  if (opts.proxyFallback) {
    sources.push(
      {
        label: "jina.ai",
        url: `https://r.jina.ai/${target}`,
        headers: { ...reqHeaders, "X-Return-Format": "html" },
        tries: 3,
        unwrap: (body) => body,
        trusted: false,
      },
      {
        label: "allorigins",
        url: `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
        headers: reqHeaders,
        tries: 2,
        unwrap: (body) => {
          const parsed = JSON.parse(body) as { contents?: unknown };
          return typeof parsed.contents === "string" ? parsed.contents : "";
        },
        trusted: false,
      },
      {
        label: "allorigins (raw)",
        url: `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
        headers: reqHeaders,
        tries: 2,
        unwrap: (body) => body,
        trusted: false,
      },
    );
  }

  let lastError = "";

  for (const source of sources) {
    for (let attempt = 1; attempt <= source.tries; attempt++) {
      if (source.label !== "direct") {
        progress(
          attempt === 1
            ? `Direct fetch blocked — trying proxy (${source.label})…`
            : `Retrying ${source.label} (${attempt}/${source.tries})…`,
        );
      }
      try {
        const res = await http.get(source.url, source.headers);
        const html = source.unwrap(res.text);
        if (!html) throw new Error("empty response");
        if (!source.trusted && !html.includes(host)) {
          throw new Error("proxy returned an unexpected page");
        }
        return html;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < source.tries) {
          await sleep(opts.retryDelayMs * attempt);
        }
      }
    }
  }

  const detail = lastError ? ` (${lastError})` : "";
  if (!opts.proxyFallback) {
    throw new Error(
      `Could not fetch that page. The site may be blocking the import — turn on "Proxy fallback for blocked imports" in Recipe Vault settings and try again.${detail}`,
    );
  }
  throw new Error(
    `Could not fetch that page, even via the proxy fallbacks. The site or the proxies may be down right now — try again in a bit, or import on desktop and sync.${detail}`,
  );
}
