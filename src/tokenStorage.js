// Where the auth token lives depends on the "Remember me" choice made at login: checked ->
// localStorage (survives closing the browser), unchecked -> sessionStorage (cleared when the
// browser session ends). Only one of the two ever holds the token at a time.
const KEY = 'token';

export function getToken() {
  return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
}

export function setToken(token, persist) {
  if (persist) {
    localStorage.setItem(KEY, token);
    sessionStorage.removeItem(KEY);
  } else {
    sessionStorage.setItem(KEY, token);
    localStorage.removeItem(KEY);
  }
}

/** Whether the current token was stored under a "Remember me" login — used when a token gets
    reissued mid-flow (e.g. the forced password change) so the reissued one lands in the same
    storage as the original, instead of silently losing the user's remember-me choice. */
export function isPersistentToken() {
  return !!localStorage.getItem(KEY);
}

export function clearToken() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
