// Cross-origin fetchers. Run only inside the background service worker or
// the extension popup — host_permissions bypass CORS there.

export async function fetchAll({ zaiApiKey, zaiJwt, deepseekApiKey, enabled = {} } = {}) {
  const jobs = [];
  if (enabled.zai !== false) jobs.push(fetchZai({ apiKey: zaiApiKey, jwt: zaiJwt }));
  if (enabled.claude !== false) jobs.push(fetchClaude());
  if (enabled.codex !== false) jobs.push(fetchCodex());
  if (enabled.ollama !== false) jobs.push(fetchOllama());
  if (enabled.deepseek !== false) jobs.push(fetchDeepSeek({ apiKey: deepseekApiKey }));
  if (enabled.minimax !== false) jobs.push(fetchMiniMax());
  return Promise.all(jobs);
}

export async function fetchZai({ apiKey, jwt } = {}) {
  // Prefer the JWT captured from a z.ai tab (zero-config). Fall back to the
  // API key from the options page. If neither is present, tell the user how
  // to set it up.
  const token = jwt || apiKey;
  if (!token) {
    return {
      provider: 'zai',
      ok: false,
      error: 'no credentials — visit z.ai while logged in (JWT captured automatically) or paste API key in extension options',
    };
  }
  try {
    const res = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return { provider: 'zai', ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    if (body.code !== 200 || !body.data) {
      // If JWT failed and we have an API key, retry with the API key.
      if (jwt && apiKey && jwt !== apiKey) {
        const retry = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        });
        if (retry.ok) {
          const b2 = await retry.json();
          if (b2.code === 200 && b2.data) return formatZai(b2, 'api-key');
        }
      }
      return { provider: 'zai', ok: false, error: body.msg || 'unexpected response' };
    }
    return formatZai(body, jwt ? 'jwt' : 'api-key');
  } catch (e) {
    return { provider: 'zai', ok: false, error: e.message };
  }
}

function formatZai(body, authSource) {
  const limits = body.data.limits || [];
  const rows = limits.map((l) => {
    const win = zaiWindow(l);
    return {
      type: l.type,
      win,
      label: zaiLabel(l, win),
      used_pct: typeof l.percentage === 'number' ? l.percentage : null,
      usage: l.usage ?? null,
      remaining: l.remaining ?? null,
      resets_at: l.nextResetTime ? new Date(l.nextResetTime).toISOString() : null,
    };
  });
  // Sort by next reset ascending so short, actionable windows (5h) appear
  // before monthly/long-running ones — more intuitive at a glance.
  rows.sort(byResetsAt);
  return {
    provider: 'zai',
    ok: true,
    plan: body.data.level || null,
    auth_source: authSource,
    windows: rows.map(({ type, win, ...rest }) => rest),
  };
}

// ZAI's API names don't map to the UI terminology:
//   TOKENS_LIMIT → the "Hours Quota" (main LLM quota, 5h on legacy plans)
//   TIME_LIMIT   → "Tool usage" (Web Search / Reader / Zread call counter)
// We surface that mapping in labels so the dashboard matches ZAI's page.
function zaiLabel(l, win) {
  if (l.type === 'TIME_LIMIT') return win ? `tool usage (${win})` : 'tool usage';
  if (l.type === 'TOKENS_LIMIT') return win || 'tokens';
  return String(l.type || 'limit').toLowerCase().replace('_limit', '');
}

function zaiWindow(l) {
  const hrs = l.nextResetTime ? (l.nextResetTime - Date.now()) / 3_600_000 : null;
  if (hrs === null || hrs <= 0) return null;
  if (hrs < 6) return '5h';
  if (hrs < 48) return 'daily';
  if (hrs < 10 * 24) return 'weekly';
  if (hrs < 45 * 24) return 'monthly';
  return 'long';
}

function byResetsAt(a, b) {
  if (!a.resets_at && !b.resets_at) return 0;
  if (!a.resets_at) return 1;
  if (!b.resets_at) return -1;
  return new Date(a.resets_at) - new Date(b.resets_at);
}

export async function fetchCodex() {
  try {
    // 1) Get an access_token from NextAuth session (requires chatgpt.com web login).
    const sessRes = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
    if (!sessRes.ok) {
      return { provider: 'codex', ok: false, error: `session HTTP ${sessRes.status} — login to chatgpt.com?` };
    }
    const sess = await sessRes.json();
    const token = sess?.accessToken;
    if (!token) {
      return { provider: 'codex', ok: false, error: 'no accessToken in session — login to chatgpt.com?' };
    }

    // 2) Call wham/usage with the Bearer token + cookies.
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      return { provider: 'codex', ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const windows = [];
    const primary = body?.rate_limit?.primary_window;
    const secondary = body?.rate_limit?.secondary_window;
    if (primary) windows.push(codexWindow('session (5h)', primary));
    if (secondary) windows.push(codexWindow('weekly (7d)', secondary));
    for (const extra of body?.additional_rate_limits || []) {
      const p = extra?.rate_limit?.primary_window;
      const s = extra?.rate_limit?.secondary_window;
      const name = extra?.limit_name || 'extra';
      if (p) windows.push(codexWindow(`${name} 5h`, p));
      if (s) windows.push(codexWindow(`${name} 7d`, s));
    }
    return { provider: 'codex', ok: true, plan: body.plan_type ?? null, windows };
  } catch (e) {
    return { provider: 'codex', ok: false, error: e.message };
  }
}

function codexWindow(label, w) {
  return {
    label,
    used_pct: w.used_percent ?? null,
    resets_at: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null,
    window_seconds: w.limit_window_seconds ?? null,
  };
}

export async function fetchOllama() {
  try {
    const res = await fetch('https://ollama.com/settings', { credentials: 'include' });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 302 ? ' — login to ollama.com?' : '';
      return { provider: 'ollama', ok: false, error: `HTTP ${res.status}${hint}` };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    const plan = (text.match(/Cloud Usage\s*\n\s*(\w+)/i) || [])[1] || null;
    const s = text.match(/Session usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i);
    const w = text.match(/Weekly usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i);
    const windows = [
      s && { label: 'session', used_pct: parseFloat(s[1]), resets_in: s[2].trim() },
      w && { label: 'weekly', used_pct: parseFloat(w[1]), resets_in: w[2].trim() },
    ].filter(Boolean);
    if (windows.length === 0) {
      return { provider: 'ollama', ok: false, error: 'could not parse usage — page layout changed?' };
    }
    return { provider: 'ollama', ok: true, plan, windows };
  } catch (e) {
    return { provider: 'ollama', ok: false, error: e.message };
  }
}

export async function fetchClaude() {
  try {
    const bootRes = await fetch('https://claude.ai/api/bootstrap', { credentials: 'include' });
    if (!bootRes.ok) {
      const hint = bootRes.status === 401 ? ' — login to claude.ai?' : '';
      return { provider: 'claude', ok: false, error: `bootstrap HTTP ${bootRes.status}${hint}` };
    }
    const boot = await bootRes.json();
    const memberships = boot?.account?.memberships || [];
    if (memberships.length === 0) {
      return { provider: 'claude', ok: false, error: 'no organizations on account' };
    }
    // Prefer the active (non-api-disabled, stripe-billed) org.
    const active = memberships.find((m) => !m.organization?.api_disabled_reason && m.organization?.billing_type === 'stripe_subscription')
      || memberships.find((m) => !m.organization?.api_disabled_reason)
      || memberships[0];
    const orgId = active.organization?.uuid;
    if (!orgId) return { provider: 'claude', ok: false, error: 'no org uuid' };

    const usageRes = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, { credentials: 'include' });
    if (!usageRes.ok) return { provider: 'claude', ok: false, error: `usage HTTP ${usageRes.status}` };
    const u = await usageRes.json();

    const windows = [];
    pushClaudeWindow(windows, 'session (5h)', u.five_hour);
    pushClaudeWindow(windows, 'weekly (all)', u.seven_day);
    pushClaudeWindow(windows, 'weekly Sonnet', u.seven_day_sonnet);
    pushClaudeWindow(windows, 'weekly Opus', u.seven_day_opus);

    const extra = u.extra_usage;
    if (extra && extra.is_enabled && typeof extra.used_credits === 'number' && typeof extra.monthly_limit === 'number' && extra.monthly_limit > 0) {
      windows.push({
        label: `extra ($${(extra.used_credits / 100).toFixed(2)}/$${(extra.monthly_limit / 100).toFixed(0)})`,
        used_pct: Math.round((extra.used_credits / extra.monthly_limit) * 1000) / 10,
        resets_at: extra.resets_at || null,
      });
    }

    return {
      provider: 'claude',
      ok: true,
      plan: active.organization?.rate_limit_tier || null,
      windows,
      org_name: active.organization?.name || null,
    };
  } catch (e) {
    return { provider: 'claude', ok: false, error: e.message };
  }
}

function pushClaudeWindow(arr, label, w) {
  if (!w || typeof w.utilization !== 'number') return;
  arr.push({ label, used_pct: w.utilization, resets_at: w.resets_at || null });
}

export async function fetchDeepSeek({ apiKey } = {}) {
  if (!apiKey) {
    return {
      provider: 'deepseek',
      ok: false,
      error: 'DeepSeek API key not set — add it in extension options',
    };
  }
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

    const info = infos.find((b) => b.currency === 'USD') || infos[0];
    const total = info.total_balance ?? '0';
    const granted = info.granted_balance ?? '0';
    const toppedUp = info.topped_up_balance ?? '0';
    const cur = info.currency || 'USD';

    return {
      provider: 'deepseek',
      ok: true,
      plan: null,
      windows: [{
        label: `balance: ${cur} ${total} (topped up: ${toppedUp}, granted: ${granted})`,
        used_pct: null,
        balance_total: total,
        balance_granted: granted,
        balance_topped_up: toppedUp,
        currency: cur,
      }],
    };
  } catch (e) {
    return { provider: 'deepseek', ok: false, error: e.message };
  }
}

export async function fetchMiniMax() {
  try {
    // MiniMax's usage API requires a full API key in the Authorization header.
    // The masked key in localStorage ("sk-api...xxx") won't work, so we first
    // call /backend/token with session cookies to get the complete key, then
    // use it to call the coding_plan/remains endpoint.

    // Step 1: Get full API key via session cookies.
    const tokenRes = await fetch('https://platform.minimax.io/backend/token', {
      credentials: 'include',
    });
    if (!tokenRes.ok) {
      const hint = tokenRes.status === 401 ? ' — login to platform.minimax.io?' : '';
      return { provider: 'minimax', ok: false, error: `token HTTP ${tokenRes.status}${hint}` };
    }
    const tokenBody = await tokenRes.json();
    if (tokenBody.base_resp?.status_code !== 0) {
      return { provider: 'minimax', ok: false, error: tokenBody.base_resp?.status_msg || 'token fetch failed' };
    }
    const fullKey = tokenBody.tokens?.[0]?.complete_token;
    if (!fullKey) {
      return { provider: 'minimax', ok: false, error: 'no API key found — create one at platform.minimax.io' };
    }

    // Step 2: Fetch coding plan usage with the full key.
    const usageRes = await fetch('https://platform.minimax.io/v1/api/openplatform/coding_plan/remains', {
      headers: { 'Authorization': `Bearer ${fullKey}`, 'Accept': 'application/json' },
    });
    if (!usageRes.ok) return { provider: 'minimax', ok: false, error: `usage HTTP ${usageRes.status}` };

    const usageBody = await usageRes.json();
    if (usageBody.base_resp?.status_code !== 0) {
      return { provider: 'minimax', ok: false, error: usageBody.base_resp?.status_msg || 'usage fetch failed' };
    }

    // Step 3: Parse model remains into windows.
    const models = usageBody.model_remains || [];
    const windows = [];

    for (const m of models) {
      // Interval (5h) window
      if (m.current_interval_status === 1 && typeof m.current_interval_remaining_percent === 'number') {
        const usedPct = Math.round((100 - m.current_interval_remaining_percent) * 10) / 10;
        const resetsAt = m.end_time ? new Date(m.end_time).toISOString() : null;
        windows.push({
          label: `${m.model_name || 'model'} (5h)`,
          used_pct: usedPct,
          resets_at: resetsAt,
        });
      }
      // Weekly window
      if (m.current_weekly_status === 1 && typeof m.current_weekly_remaining_percent === 'number') {
        const usedPct = Math.round((100 - m.current_weekly_remaining_percent) * 10) / 10;
        const resetsAt = m.weekly_end_time ? new Date(m.weekly_end_time).toISOString() : null;
        windows.push({
          label: `${m.model_name || 'model'} (weekly)`,
          used_pct: usedPct,
          resets_at: resetsAt,
        });
      }
    }

    if (windows.length === 0) {
      return { provider: 'minimax', ok: false, error: 'no active usage windows' };
    }

    return { provider: 'minimax', ok: true, plan: null, windows };
  } catch (e) {
    return { provider: 'minimax', ok: false, error: e.message };
  }
}
