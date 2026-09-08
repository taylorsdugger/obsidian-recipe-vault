#!/usr/bin/env node
// Generates the two auth secrets: a PBKDF2 hash of the password you type, and
// a random cookie signing key. Neither value is written to disk - copy them
// into .dev.vars for local dev and into `wrangler secret put` for the worker.
//
//   node scripts/hash-password.mjs
//   node scripts/hash-password.mjs --iterations 60000
//
// The iteration count travels inside the hash string, so changing it later
// does not invalidate a password already in use. Keep it under the Workers
// CPU budget - 100k is about 8ms, and login is the only request that pays it.

import { webcrypto as crypto } from 'node:crypto'
import process from 'node:process'

const args = process.argv.slice(2)
const flag = args.indexOf('--iterations')
const ITERATIONS = flag === -1 ? 100_000 : Number(args[flag + 1])

if (!Number.isInteger(ITERATIONS) || ITERATIONS < 10_000) {
  console.error('--iterations must be an integer of at least 10000')
  process.exit(1)
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')

/** Piped input, read once up front so both prompts can take a line from it. */
async function readPipedLines() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').split('\n')
}

const piped = process.stdin.isTTY ? null : await readPipedLines()
let pipedAt = 0

/**
 * Prompt without echoing what gets typed. Raw mode rather than readline - a
 * muted readline interface can't be opened twice against the same stdin, so
 * the second prompt would hang forever.
 */
function askHidden(question) {
  process.stdout.write(question)

  if (piped) {
    const line = piped[pipedAt++] ?? ''
    process.stdout.write('\n')
    return Promise.resolve(line.replace(/\r$/, ''))
  }

  return new Promise((resolve) => {
    const input = process.stdin
    let value = ''

    const finish = () => {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(value)
    }

    const onData = (chunk) => {
      // A paste arrives as one chunk, so walk it a character at a time.
      for (const char of String(chunk)) {
        // Enter, or ctrl-d.
        if (char === '\n' || char === '\r' || char === '\u0004') return finish()
        if (char === '\u0003') {
          // ctrl-c: put the terminal back before bailing out.
          input.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }

    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    input.on('data', onData)
  })
}

const password = await askHidden('Password: ')
if (password.length < 12) {
  // Length is the defence here, not the hash. This password is the only thing
  // between the internet and the data.
  console.error('Use at least 12 characters.')
  process.exit(1)
}
if ((await askHidden('Again: ')) !== password) {
  console.error('Those did not match.')
  process.exit(1)
}

const salt = crypto.getRandomValues(new Uint8Array(16))
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  'PBKDF2',
  false,
  ['deriveBits'],
)
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
  key,
  256,
)

const hash = `pbkdf2$sha256$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`
const cookieSecret = b64url(crypto.getRandomValues(new Uint8Array(32)))

console.log(`
Local dev - put these in .dev.vars, which is gitignored:

AUTH_PASSWORD_HASH="${hash}"
AUTH_COOKIE_SECRET="${cookieSecret}"

Deployed worker - run each and paste the value when prompted:

  npx wrangler secret put AUTH_PASSWORD_HASH
  npx wrangler secret put AUTH_COOKIE_SECRET

Rotating AUTH_COOKIE_SECRET signs every device out, which is the point if a
phone goes missing.
`)
