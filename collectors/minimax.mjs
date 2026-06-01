// MiniMax coding-plan quota collector — push-only from the browser extension.
//
// MiniMax's /v1/token_plan/remains endpoint requires browser cookie session
// auth; the Coding Plan API key (sk-cp-...) does NOT authenticate this endpoint.
// The Chrome extension fetches using the user's minimax.io session cookies and
// POSTs results to /ingest/minimax.

export async function collectMiniMax() {
  return {
    provider: 'minimax',
    ok: false,
    error: 'awaiting push from Chrome extension',
  };
}
