// Injected on https://platform.minimax.io/*. Reads auth tokens from
// localStorage and forwards them to the background service worker so
// fetchMiniMax() can call the API with proper auth.
//
// The platform stores auth info in localStorage keys like:
//   - token
//   - access_token
//   - minimax_token
//   - or similar — we scan all keys that look like JWTs/bearer tokens.

(function () {
  try {
    // Collect potential auth tokens from localStorage.
    const candidates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      // Heuristic: looks like a JWT (eyJ...) or a long token string.
      if (val && val.length > 20 && (val.startsWith('eyJ') || /token|auth|session|jwt/i.test(key))) {
        candidates.push({ key, value: val });
      }
    }

    // Also check cookie-based tokens.
    const cookieStr = document.cookie;
    if (cookieStr) {
      const cookiePairs = cookieStr.split(';');
      for (const pair of cookiePairs) {
        const [k, ...rest] = pair.split('=');
        const key = k.trim();
        const val = rest.join('=').trim();
        if (val && val.length > 20 && /token|auth|session|jwt/i.test(key)) {
          candidates.push({ key: `cookie:${key}`, value: val });
        }
      }
    }

    if (candidates.length > 0) {
      chrome.runtime.sendMessage({ type: 'minimax:capture-tokens', tokens: candidates });
    }
  } catch {
    // localStorage access can fail in rare sandboxed frames — ignore.
  }
})();
