// lichessAuth.ts: Not in lila. "Sign in with Lichess", for the masters database, which only answers
// someone signed in (mastersExplorer.ts). It's Lichess's OAuth with PKCE, which Lichess's API
// documentation describes for apps that run in the browser: no registration and no secret. The page
// sends you to Lichess's own sign-in page, and Lichess sends you back with a code, which the page
// swaps for a token. The token asks for no permissions, so it can't read or change anything of
// yours. This browser keeps it (localStorage) until you sign out.

const LICHESS = 'https://lichess.org';
const CLIENT_ID = 'mistake-trainer'; // Lichess only asks that it name the app
const ACCOUNT_KEY = 'mistakeTrainer.lichess'; // the token and your username, once signed in
const PENDING_KEY = 'mistakeTrainer.signIn'; // while you're at Lichess's page

export interface LichessAccount {
  token: string;
  username: string;
}

export function signedIn(): LichessAccount | undefined {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

// Where Lichess sends you back: this page, without the part after #, which Lichess wouldn't keep.
const redirectUri = (): string => location.origin + location.pathname;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomText = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

// PKCE's code challenge: the SHA-256 of the verifier, which only this page knows, so that the code
// Lichess sends back is no use to anyone else.
export const codeChallenge = async (verifier: string): Promise<string> =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

// Goes to Lichess's sign-in page. When Lichess sends you back, the page finishes signing in
// (finishSignIn), and shows what it showed before, e.g. Training settings.
export async function signIn(): Promise<void> {
  const verifier = randomText(),
    state = randomText(); // to recognise Lichess's answer as the one to this
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, hash: location.hash }));
  const url = new URL(`${LICHESS}/oauth`);
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  location.assign(url.href);
}

// When the page opens: if Lichess has just sent you back, swaps its code for a token, asks Lichess
// for your username, and takes the code out of the address. Returns what went wrong, if anything
// did; nothing if you chose not to sign in.
export async function finishSignIn(): Promise<string | undefined> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code'),
    error = params.get('error');
  if (!code && !error) return;
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
  sessionStorage.removeItem(PENDING_KEY);
  history.replaceState(null, '', location.pathname + (pending?.hash ?? ''));
  if (error) return error === 'access_denied' ? undefined : `Lichess didn't sign you in (${error}).`;
  if (!pending || params.get('state') !== pending.state) return "Couldn't sign in to Lichess. Try again.";
  const response = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: pending.verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) return `Couldn't sign in to Lichess (${response.status}). Try again.`;
  const { access_token: token } = (await response.json()) as { access_token: string };
  const account = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
  const username = account.ok ? ((await account.json()) as { username: string }).username : '?';
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ token, username }));
  return undefined;
}

// Signs out: Lichess cancels the token, and this browser forgets it.
export async function signOut(): Promise<void> {
  const account = signedIn();
  localStorage.removeItem(ACCOUNT_KEY);
  if (account)
    await fetch(`${LICHESS}/api/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${account.token}` } }).catch(
      () => {}, // forgotten here anyway
    );
}
