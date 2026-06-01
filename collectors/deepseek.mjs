// DeepSeek balance collector.
// Fetches current credit balance via API key.
// Endpoint: GET https://api.deepseek.com/user/balance

export async function collectDeepSeek({ apiKey } = {}) {
  if (!apiKey) return { provider: 'deepseek', ok: false, error: 'DEEPSEEK_API_KEY not set' };

  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return { provider: 'deepseek', ok: false, error: `HTTP ${res.status}` };

    const body = await res.json();
    if (!body.is_available) {
      return { provider: 'deepseek', ok: false, error: 'account unavailable' };
    }

    const infos = body.balance_infos || [];
    if (infos.length === 0) {
      return { provider: 'deepseek', ok: false, error: 'no balance info returned' };
    }

    // Prefer USD entry; fall back to first entry.
    const info = infos.find((b) => b.currency === 'USD') || infos[0];
    const total = info.total_balance ?? '0';
    const granted = info.granted_balance ?? '0';
    const toppedUp = info.topped_up_balance ?? '0';
    const cur = info.currency || 'USD';

    const windows = [{
      label: `balance: ${cur} ${total} (topped up: ${toppedUp}, granted: ${granted})`,
      used_pct: null,
      balance_total: total,
      balance_granted: granted,
      balance_topped_up: toppedUp,
      currency: cur,
    }];

    return { provider: 'deepseek', ok: true, plan: null, windows };
  } catch (e) {
    return { provider: 'deepseek', ok: false, error: `fetch failed: ${e.message}` };
  }
}
