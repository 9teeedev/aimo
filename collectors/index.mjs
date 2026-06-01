import { collectZai } from './zai.mjs';
import { collectClaude } from './claude.mjs';
import { collectCodex } from './codex.mjs';
import { collectOllama } from './ollama.mjs';
import { collectDeepSeek } from './deepseek.mjs';
import { collectMiniMax } from './minimax.mjs';

export async function collectAll(cfg = {}) {
  const jobs = [
    collectZai({ apiKey: cfg.zaiApiKey }),
    collectClaude({ token: cfg.claudeToken }),
    collectCodex({ authJsonPath: cfg.codexAuthPath }),
    collectOllama({ cookie: cfg.ollamaCookie }),
    collectDeepSeek({ apiKey: cfg.deepseekApiKey }),
    collectMiniMax(),
  ];
  return Promise.all(jobs);
}

export { collectZai, collectClaude, collectCodex, collectOllama, collectDeepSeek, collectMiniMax };
