const zaiKeyInput = document.getElementById('zaikey');
const saveKeyBtn = document.getElementById('save-key');
const serverDot = document.getElementById('server-dot');
const serverText = document.getElementById('server-text');
const serverRecheckBtn = document.getElementById('server-recheck');
const zaiDot = document.getElementById('zai-dot');
const zaiText = document.getElementById('zai-text');
const zaiCaptureBtn = document.getElementById('zai-capture');
const deepseekKeyInput = document.getElementById('deepseekkey');
const saveDeepseekKeyBtn = document.getElementById('save-deepseek-key');
const deepseekDot = document.getElementById('deepseek-dot');
const deepseekText = document.getElementById('deepseek-text');
const minimaxDot = document.getElementById('minimax-dot');
const minimaxText = document.getElementById('minimax-text');
const minimaxOpenBtn = document.getElementById('minimax-open');
const toast = document.getElementById('toast');

const LOCAL_SERVER = 'http://localhost:3030';

init();

async function init() {
  await Promise.all([
    loadApiKey(),
    loadDeepseekApiKey(),
    loadEnabled(),
    checkServer(),
    checkZaiJwt(),
    checkDeepseekKey(),
  ]);

  saveKeyBtn.addEventListener('click', saveApiKey);
  saveDeepseekKeyBtn.addEventListener('click', saveDeepseekApiKey);
  serverRecheckBtn.addEventListener('click', checkServer);
  zaiCaptureBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://z.ai/' });
  });
  minimaxOpenBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://platform.minimax.io/' });
  });

  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    cb.addEventListener('change', saveEnabled);
  });

  document.querySelectorAll('button[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.copy);
      showToast('Copied');
    });
  });

  // Refresh statuses when storage updates (e.g. z.ai tab captures JWT).
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.zaiJwt) checkZaiJwt();
    if (changes.zaiApiKey) loadApiKey();
    if (changes.deepseekApiKey) { loadDeepseekApiKey(); checkDeepseekKey(); }
  });
}

async function loadEnabled() {
  const { enabled } = await chrome.storage.local.get('enabled');
  const map = enabled || {};
  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    cb.checked = map[cb.dataset.prov] !== false;
  });
}

async function saveEnabled() {
  const map = {};
  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    map[cb.dataset.prov] = cb.checked;
  });
  await chrome.storage.local.set({ enabled: map });
  // Push the enabled map to the local server so the dashboard hides disabled providers.
  try {
    await fetch(`${LOCAL_SERVER}/api/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(map),
    });
  } catch {}
  showToast('Saved');
}

async function loadApiKey() {
  const { zaiApiKey } = await chrome.storage.local.get('zaiApiKey');
  if (zaiApiKey) zaiKeyInput.value = zaiApiKey;
}

async function saveApiKey() {
  const value = zaiKeyInput.value.trim();
  await chrome.storage.local.set({ zaiApiKey: value });
  showToast(value ? 'Saved' : 'Cleared');
}

async function checkServer() {
  setDot(serverDot, 'unknown');
  serverText.textContent = 'checking…';
  try {
    const res = await fetch(`${LOCAL_SERVER}/api/ping`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      setDot(serverDot, 'on');
      serverText.textContent = 'online at localhost:3030';
    } else {
      setDot(serverDot, 'off');
      serverText.textContent = `HTTP ${res.status}`;
    }
  } catch {
    setDot(serverDot, 'off');
    serverText.textContent = 'offline — start the server below';
  }
}

async function loadDeepseekApiKey() {
  const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
  if (deepseekApiKey) deepseekKeyInput.value = deepseekApiKey;
}

async function saveDeepseekApiKey() {
  const value = deepseekKeyInput.value.trim();
  await chrome.storage.local.set({ deepseekApiKey: value });
  showToast(value ? 'Saved' : 'Cleared');
}

async function checkDeepseekKey() {
  const { deepseekApiKey } = await chrome.storage.local.get('deepseekApiKey');
  if (deepseekApiKey && deepseekApiKey.length > 10) {
    setDot(deepseekDot, 'on');
    deepseekText.textContent = `API key set (${deepseekApiKey.slice(0, 6)}…${deepseekApiKey.slice(-4)})`;
  } else {
    setDot(deepseekDot, 'off');
    deepseekText.textContent = 'not set — paste your DeepSeek API key below';
  }
}

async function checkZaiJwt() {
  const { zaiJwt, zaiJwtCapturedAt } = await chrome.storage.local.get(['zaiJwt', 'zaiJwtCapturedAt']);
  if (zaiJwt && zaiJwt.length > 20) {
    setDot(zaiDot, 'on');
    const when = zaiJwtCapturedAt ? new Date(zaiJwtCapturedAt).toLocaleString() : 'unknown';
    zaiText.textContent = `JWT captured (${when})`;
  } else {
    setDot(zaiDot, 'off');
    zaiText.textContent = 'not captured — visit z.ai once while logged in';
  }
}

function setDot(el, state) {
  el.classList.remove('status-on', 'status-off', 'status-unknown');
  el.classList.add(`status-${state}`);
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1200);
}
