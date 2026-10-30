// lichessAuth.test.ts: checks "Sign in with Lichess", with stand-ins for Lichess and the browser.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { codeChallenge, finishSignIn, signedIn, signIn, signOut } from './lichessAuth';

// A stand-in for localStorage or sessionStorage, keeping what's stored in `stored`.
const standIn = (stored: Record<string, string>) => ({
  getItem: (key: string) => stored[key] ?? null,
  setItem: (key: string, value: string) => (stored[key] = value),
  removeItem: (key: string) => delete stored[key],
});
let local: Record<string, string>, session: Record<string, string>;
let page: { origin: string; pathname: string; hash: string; search: string; assign: (url: string) => void; went?: string };
let addresses: string[]; // what history.replaceState set the address to
let asked: { url: string; init?: RequestInit }[];
beforeEach(() => {
  local = {};
  session = {};
  addresses = [];
  asked = [];
  page = { origin: 'http://localhost:5173', pathname: '/', hash: '#settings', search: '', assign: url => (page.went = url) };
  vi.stubGlobal('localStorage', standIn(local));
  vi.stubGlobal('sessionStorage', standIn(session));
  vi.stubGlobal('location', page);
  vi.stubGlobal('history', { replaceState: (_: unknown, __: string, url: string) => addresses.push(url) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({ url, init });
      if (url.endsWith('/api/token') && init?.method === 'POST') return Response.json({ token_type: 'Bearer', access_token: 'lio_T' });
      if (url.endsWith('/api/account')) return Response.json({ id: 'mugglesman1982', username: 'MugglesMan1982' });
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("PKCE's code challenge is the verifier's SHA-256, as in the standard's example (RFC 7636)", async () => {
  expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test("signing in goes to Lichess's page, asking it to send you back here with a code for this page alone", async () => {
  await signIn();
  const pending = JSON.parse(session['mistakeTrainer.signIn']);
  expect(pending.hash).toBe('#settings');
  const url = new URL(page.went!);
  expect(url.origin + url.pathname).toBe('https://lichess.org/oauth');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: 'code',
    client_id: 'mistake-trainer',
    redirect_uri: 'http://localhost:5173/',
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(pending.verifier),
    state: pending.state,
  });
});

test('back from Lichess, the code is swapped for a token, and your username kept with it', async () => {
  session['mistakeTrainer.signIn'] = JSON.stringify({ verifier: 'V', state: 'S', hash: '#settings' });
  page.search = '?code=C&state=S';
  expect(await finishSignIn()).toBeUndefined();
  expect(addresses).toEqual(['/#settings']); // the code out of the address, back on Training settings
  const [token, account] = asked;
  expect(token.url).toBe('https://lichess.org/api/token');
  expect(Object.fromEntries(new URLSearchParams(token.init!.body as URLSearchParams))).toEqual({
    grant_type: 'authorization_code',
    code: 'C',
    code_verifier: 'V',
    redirect_uri: 'http://localhost:5173/',
    client_id: 'mistake-trainer',
  });
  expect(account.url).toBe('https://lichess.org/api/account');
  expect((account.init!.headers as Record<string, string>).Authorization).toBe('Bearer lio_T');
  expect(signedIn()).toEqual({ token: 'lio_T', username: 'MugglesMan1982' });
  expect(session['mistakeTrainer.signIn']).toBeUndefined();
});

test('an answer the page wasn\'t waiting for is refused; saying no on Lichess\'s page signs nothing in, quietly', async () => {
  session['mistakeTrainer.signIn'] = JSON.stringify({ verifier: 'V', state: 'S', hash: '' });
  page.search = '?code=C&state=other';
  expect(await finishSignIn()).toBe("Couldn't sign in to Lichess. Try again.");
  page.search = '?error=access_denied&state=S';
  expect(await finishSignIn()).toBeUndefined();
  expect(asked).toEqual([]);
  expect(signedIn()).toBeUndefined();
  page.search = ''; // an ordinary visit: nothing to do
  addresses = [];
  expect(await finishSignIn()).toBeUndefined();
  expect(addresses).toEqual([]);
});

test('signing out: Lichess cancels the token, and this browser forgets it', async () => {
  local['mistakeTrainer.lichess'] = JSON.stringify({ token: 'lio_T', username: 'MugglesMan1982' });
  await signOut();
  expect(signedIn()).toBeUndefined();
  expect(asked.map(a => [a.url, a.init?.method, (a.init?.headers as Record<string, string>).Authorization])).toEqual([
    ['https://lichess.org/api/token', 'DELETE', 'Bearer lio_T'],
  ]);
});
