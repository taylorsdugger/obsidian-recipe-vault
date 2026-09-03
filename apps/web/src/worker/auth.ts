import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

import type { AppBindings, Env } from "./env";

/** One household, one passcode, one cookie (locked decision 3). */
const COOKIE_NAME = "household";
const COOKIE_VALUE = "in";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Compare two strings without leaking their common prefix through timing.
 * The passcode is short and the app is two people behind a random URL, but
 * this costs nothing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  // Compare a fixed number of bytes so the loop length doesn't reveal the
  // real length; a length mismatch still fails via the flag.
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** True when the request carries a valid session cookie. */
export async function isSignedIn(c: Context<AppBindings>): Promise<boolean> {
  const value = await getSignedCookie(c, c.env.HOUSEHOLD_SECRET, COOKIE_NAME);
  return value === COOKIE_VALUE;
}

/** Set the session cookie after a correct passcode. */
export async function signIn(c: Context<AppBindings>): Promise<void> {
  await setSignedCookie(c, COOKIE_NAME, COOKIE_VALUE, c.env.HOUSEHOLD_SECRET, {
    httpOnly: true,
    // `wrangler dev` serves plain http on localhost, so don't demand https there.
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

/** Clear the session cookie. */
export function signOut(c: Context<AppBindings>): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** Check a submitted passcode against the configured one. */
export function passcodeMatches(env: Env, submitted: unknown): boolean {
  if (typeof submitted !== "string" || submitted.length === 0) return false;
  const expected = env.HOUSEHOLD_PASSCODE ?? "";
  if (!expected) return false;
  return constantTimeEqual(submitted, expected);
}

/** Reject anything under /api that isn't the login/logout pair. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!(await isSignedIn(c))) {
    return c.json({ error: "Not signed in." }, 401);
  }
  await next();
};
