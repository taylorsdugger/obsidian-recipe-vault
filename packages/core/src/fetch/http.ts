/** The bits of an HTTP response the fetch path reads. */
export interface HttpResponse {
  status: number;
  text: string;
}

/**
 * The one network capability core needs. The plugin backs this with Obsidian's
 * `requestUrl` (which is not subject to CORS); the web app backs it with the
 * platform `fetch`.
 */
export interface HttpPort {
  get(url: string, headers: Record<string, string>): Promise<HttpResponse>;
}
