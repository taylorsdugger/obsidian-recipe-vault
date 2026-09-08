import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { AppBindings, Env } from "./env";

// One household, one password (locked decision 3). The password hash and the
// cookie signing key are Worker secrets - `wrangler secret put`, or .dev.vars
// locally. Neither ever lands in wrangler.toml or in the repo.

const COOKIE = "recipe_vault_session";
const COOKIE_VERSION = "v1";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Every failed login takes at least this long, however it failed. */
const FAILURE_FLOOR_MS = 400;

// ---- primitives -----------------------------------------------------------

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(value: string): Uint8Array {
  // Allocate the buffer explicitly - Uint8Array.from widens to ArrayBufferLike,
  // which WebCrypto's BufferSource won't take.
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isB64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9\-_+/]+={0,2}$/.test(value);
}

/** Compare without leaking where two values first differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(signingKey: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Hash format: pbkdf2$sha256$<iterations>$<salt>$<hash>, all base64url. The
 * iteration count travels with the hash, so it can be tuned later without
 * invalidating the password already stored.
 */
async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  const [scheme, hashName, iterations, salt, expected] = parts;

  // A malformed secret is a config mistake, not a wrong password. Say so
  // instead of letting atob throw an opaque DOMException, or returning false
  // and making every correct password look wrong.
  if (
    parts.length !== 5 ||
    scheme !== "pbkdf2" ||
    hashName !== "sha256" ||
    !/^[1-9][0-9]*$/.test(iterations) ||
    !isB64(salt) ||
    !isB64(expected)
  ) {
    throw new Error(
      "AUTH_PASSWORD_HASH is malformed. Regenerate it with " +
        "scripts/hash-password.mjs and copy the whole value.",
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromB64(salt),
      iterations: Number(iterations),
    },
    key,
    256,
  );
  return timingSafeEqual(new Uint8Array(bits), fromB64(expected));
}

function secret(env: Env, name: "AUTH_COOKIE_SECRET" | "AUTH_PASSWORD_HASH") {
  const value = env[name];
  if (!value) {
    // Fail loudly rather than silently locking the app open or shut.
    throw new Error(
      `${name} is not set. Add it to .dev.vars locally, or run ` +
        `\`npx wrangler secret put ${name}\` for the deployed worker. ` +
        `scripts/hash-password.mjs generates both.`,
    );
  }
  return value;
}

// ---- cookie ---------------------------------------------------------------

async function signCookie(env: Env, expiresAt: number): Promise<string> {
  const payload = `${COOKIE_VERSION}.${expiresAt}`;
  return `${payload}.${await hmac(secret(env, "AUTH_COOKIE_SECRET"), payload)}`;
}

async function cookieIsValid(
  env: Env,
  value: string | undefined,
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;

  const [version, expiresAt, signature] = parts;
  if (version !== COOKIE_VERSION) return false;

  const expected = await hmac(
    secret(env, "AUTH_COOKIE_SECRET"),
    `${version}.${expiresAt}`,
  );
  if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) {
    return false;
  }
  return Number(expiresAt) * 1000 > Date.now();
}

/** True when the request carries a valid, unexpired session cookie. */
export function isSignedIn(c: Context<AppBindings>): Promise<boolean> {
  return cookieIsValid(c.env, getCookie(c, COOKIE));
}

/**
 * Check a password and, when it matches, set the session cookie. Returns false
 * for a wrong password after holding the response to a fixed floor, which caps
 * guessing throughput and flattens the timing difference between a wrong
 * password and a malformed hash.
 */
export async function signIn(
  c: Context<AppBindings>,
  password: unknown,
): Promise<boolean> {
  const started = Date.now();
  const submitted = typeof password === "string" ? password.slice(0, 200) : "";
  const ok =
    submitted.length > 0 &&
    (await verifyPassword(submitted, secret(c.env, "AUTH_PASSWORD_HASH")));

  if (!ok) {
    const wait = FAILURE_FLOOR_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return false;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  setCookie(c, COOKIE, await signCookie(c.env, expiresAt), {
    httpOnly: true,
    sameSite: "Lax",
    // Secure only over https, so http://localhost still keeps you signed in.
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}

/** Clear the session cookie. */
export function signOut(c: Context<AppBindings>): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Reject anything under /api that isn't the login/logout pair. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!(await isSignedIn(c))) {
    return c.json({ error: "Not signed in." }, 401);
  }
  await next();
};
