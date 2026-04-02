#!/usr/bin/env node
'use strict';
/**
 * OmniShapeAgent CLI — Autonomous AI agent in your terminal
 *
 * Install:  npm link  → then run `OmniShapeAgent` or `oshape` from anywhere
 * Usage:    OmniShapeAgent [--run "task"] [--server url] [--model name] [--dream]
 */

const readline = require('readline');
const https    = require('https');
const http     = require('http');
const os       = require('os');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

// ─── ANSI / Color helpers ─────────────────────────────────────────────────────
const C = {
  r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', i:'\x1b[3m', u:'\x1b[4m',
  red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', blue:'\x1b[34m',
  magenta:'\x1b[35m', cyan:'\x1b[36m', white:'\x1b[37m', gray:'\x1b[90m',
  bred:'\x1b[91m', bgreen:'\x1b[92m', byellow:'\x1b[93m', bblue:'\x1b[94m',
  bmagenta:'\x1b[95m', bcyan:'\x1b[96m', bwhite:'\x1b[97m',
  bgred:'\x1b[41m', bggreen:'\x1b[42m', bgblue:'\x1b[44m',
};

// RGB 24-bit color (foreground)
function rgb(r, g, b) { return `\x1b[38;2;${r};${g};${b}m`; }
function bgRgb(r, g, b) { return `\x1b[48;2;${r};${g};${b}m`; }

// Interpolate between two RGB colors by intensity [0..1]
function lerpRgb(from, to, t) {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

// ─── Animation Constants ──────────────────────────────────────────────────────
const SPINNER_FRAMES   = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const SPINNER_INTERVAL = 50; // ms — matches reference repo clock

const THINKING_INACTIVE        = { r:153, g:153, b:153 };
const THINKING_INACTIVE_SHIMMER= { r:185, g:185, b:185 };
const THINKING_ACTIVE          = { r:100, g:160, b:255 };
const STALL_COLOR              = { r:255, g:80,  b:80  };
const STALL_THRESHOLD_MS       = 8000;
const STALL_ANIMATION_MS       = 4000;
const SHIMMER_PERIOD_MS        = 2000;
const RAINBOW_COLORS = ['red','orange','yellow','green','blue','indigo','violet'];

// ─── Config / Persistence ─────────────────────────────────────────────────────
const CONFIG_DIR   = path.join(os.homedir(), '.shapagent');
const CONFIG_FILE  = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.txt');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const THEMES_FILE  = path.join(CONFIG_DIR, 'theme.json');

function defaultConfig() {
  return {
    serverUrl:        'http://localhost:3000',
    provider:         'auto',
    model:            '',
    companion:        '',
    temperature:      0.7,
    synergyMode:      'off',
    maxHistory:       40,
    openrouterApiKey: '',
    ollamaUrl:        'http://localhost:11434',
    vllmUrl:          'http://localhost:8000',
    thinkingMode:     'adaptive', // 'adaptive' | 'enabled' | 'disabled'
    thinkingBudget:   8000,
    effort:           3,          // 1-5
    vimMode:          false,
    fastMode:         false,
    briefMode:        false,
    theme:            'dark',     // dark | light | ocean | forest | sunset
    contextWindow:    128000,
  };
}

function loadConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (fs.existsSync(CONFIG_FILE))
      return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {}
  return defaultConfig();
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch {}
}

// ─── AppState — central session state ────────────────────────────────────────
function makeAppState() {
  return {
    // session-level accumulators
    sessionInputTokens:  0,
    sessionOutputTokens: 0,
    sessionToolCalls:    0,
    sessionCost:         0,
    sessionTurns:        0,
    sessionStart:        Date.now(),
    // per-turn
    turnInputTokens:     0,
    turnOutputTokens:    0,
    turnToolCalls:       0,
    turnStart:           0,
    // current request
    thinking:            false,
    stalled:             false,
    streaming:           false,
    aborted:             false,
    // dream mode
    dreamMode:           false,
    dreamDepth:          0,
  };
}

// ─── Cost helpers ─────────────────────────────────────────────────────────────
const COST_PER_1M_INPUT  = { ollama: 0, vllm: 0, openrouter: 1.50 };
const COST_PER_1M_OUTPUT = { ollama: 0, vllm: 0, openrouter: 2.00 };

function estimateTokens(messages) {
  return messages.reduce((s, m) => s + Math.ceil(String(m.content || '').length / 4), 0);
}

function calcCost(inputTok, outputTok, provider) {
  const ip = COST_PER_1M_INPUT[provider]  ?? 1.50;
  const op = COST_PER_1M_OUTPUT[provider] ?? 2.00;
  return (inputTok / 1_000_000) * ip + (outputTok / 1_000_000) * op;
}

function formatCost(cost) {
  if (cost === 0) return `${C.bgreen}free${C.r}`;
  if (cost >= 0.5) return `${C.yellow}$${(Math.round(cost * 100) / 100).toFixed(2)}${C.r}`;
  const decimals = cost < 0.001 ? 6 : cost < 0.01 ? 5 : 4;
  return `${C.yellow}$${cost.toFixed(decimals)}${C.r}`;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Thinking mode helpers ────────────────────────────────────────────────────
// Detect ultrathink keyword → max budget
function detectThinkingKeyword(text) {
  if (/\bultrathink\b/i.test(text)) return { mode: 'enabled', budget: 32000 };
  if (/\bdeep think\b|\bthink deep\b/i.test(text)) return { mode: 'enabled', budget: 16000 };
  if (/\bthink\b/i.test(text)) return { mode: 'enabled', budget: 8000 };
  return null;
}

function thinkingBudgetForEffort(effort) {
  const budgets = [1000, 4000, 8000, 16000, 32000];
  return budgets[Math.max(0, Math.min(4, effort - 1))];
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function makeRequest(serverUrl, reqPath, method, body) {
  return new Promise((resolve, reject) => {
    const full = new URL(reqPath, serverUrl);
    const data = body ? JSON.stringify(body) : undefined;
    const lib  = full.protocol === 'https:' ? https : http;
    const opts = {
      hostname: full.hostname,
      port:     full.port || (full.protocol === 'https:' ? 443 : 80),
      path:     full.pathname + full.search,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    };
    const req = lib.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: { _raw: buf } }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function streamPost(serverUrl, reqPath, body) {
  return new Promise((resolve, reject) => {
    const full = new URL(reqPath, serverUrl);
    const data = JSON.stringify(body);
    const lib  = full.protocol === 'https:' ? https : http;
    const opts = {
      hostname: full.hostname,
      port:     full.port || (full.protocol === 'https:' ? 443 : 80),
      path:     full.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = lib.request(opts, res => resolve({ res, req }));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const api = {
  get:  (srv, p)    => makeRequest(srv, p, 'GET',  null).then(r => r.body),
  post: (srv, p, b) => makeRequest(srv, p, 'POST', b).then(r => r.body),
};

// ─── Diff Engine ──────────────────────────────────────────────────────────────
function diffLines(oldText, newText) {
  const a = (oldText || '').split('\n').slice(0, 400);
  const b = (newText || '').split('\n').slice(0, 400);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m+1 }, () => new Uint16Array(n+1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) { ops.unshift({type:'=',line:a[i-1]}); i--; j--; }
    else if (j > 0 && (i===0 || dp[i][j-1] >= dp[i-1][j])) { ops.unshift({type:'+',line:b[j-1]}); j--; }
    else { ops.unshift({type:'-',line:a[i-1]}); i--; }
  }
  return ops;
}

function renderDiff(filePath, oldContent, newContent) {
  const isNew = oldContent === null;
  const diff = isNew
    ? (newContent||'').split('\n').map(l => ({type:'+',line:l}))
    : diffLines(oldContent, newContent);
  const added = diff.filter(d => d.type==='+').length;
  const removed = diff.filter(d => d.type==='-').length;
  if (!added && !removed && !isNew) return;
  const icon = isNew ? `${C.bgreen}+${C.r}` : `${C.bcyan}~${C.r}`;
  console.log(`\n  ${icon} ${C.b}${filePath}${C.r}  ${C.bgreen}+${added}${C.r} ${C.red}-${removed}${C.r}`);
  const MAX = 30;
  let shown = 0, ctxBuf = [], lastWasChange = false, skipped = 0;
  for (const d of diff) {
    if (d.type === '=') {
      if (lastWasChange) { ctxBuf.push(d.line); if (ctxBuf.length >= 2) { lastWasChange = false; ctxBuf = []; } }
      else { ctxBuf.push(d.line); if (ctxBuf.length > 2) { ctxBuf.shift(); skipped++; } }
      continue;
    }
    if (ctxBuf.length && !lastWasChange) {
      if (skipped > ctxBuf.length) console.log(`  ${C.gray}  @@ ... ${skipped} lines ...${C.r}`);
      ctxBuf.forEach(l => console.log(`  ${C.gray}   ${l.slice(0,110)}${C.r}`));
      ctxBuf = []; skipped = 0;
    }
    lastWasChange = true;
    if (shown >= MAX) continue;
    if (d.type === '+') console.log(`  ${C.bgreen}+${C.r} ${C.bgreen}${d.line.slice(0,110)}${C.r}`);
    else                console.log(`  ${C.red}-${C.r} ${C.red}${d.line.slice(0,110)}${C.r}`);
    shown++;
  }
  if (shown < added + removed) console.log(`  ${C.gray}  ... ${added+removed-shown} more lines ...${C.r}`);
  console.log();
}

function extractAndShowFileDiffs(text) {
  const re = /```tool\s*(\{[\s\S]*?\})\s*```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let call; try { call = JSON.parse(m[1]); } catch { continue; }
    const { name, args = {} } = call;
    if ((name === 'write_file' || name === 'create_file') && args.path && args.content !== undefined) {
      const abs = path.resolve(args.path);
      try { renderDiff(args.path, fs.existsSync(abs) ? fs.readFileSync(abs,'utf8') : null, args.content); } catch {}
    } else if (name === 'patch_file' && args.path && args.old !== undefined && args.new !== undefined) {
      console.log(`\n  ${C.bcyan}~${C.r} ${C.b}${args.path}${C.r}  ${C.gray}(patch)${C.r}`);
      String(args.old).split('\n').slice(0,12).forEach(l => console.log(`  ${C.red}-${C.r} ${C.red}${l.slice(0,110)}${C.r}`));
      String(args.new).split('\n').slice(0,12).forEach(l => console.log(`  ${C.bgreen}+${C.r} ${C.bgreen}${l.slice(0,110)}${C.r}`));
      console.log();
    } else if (name === 'delete_file' && args.path) {
      console.log(`\n  ${C.red}✗${C.r} ${C.b}${args.path}${C.r}  ${C.gray}(deleted)${C.r}\n`);
    }
  }
}

// ─── Output Formatter ─────────────────────────────────────────────────────────
function fmt(text) {
  if (!text) return '';
  let out = '';
  const parts = text.split(/(\[THINKING\][\s\S]*?\[THOUGHT_END\])/g);
  for (const part of parts) {
    if (part.startsWith('[THINKING]')) {
      const raw = part.replace('[THINKING]','').replace('[THOUGHT_END]','').trim();
      const lines = raw.split('\n').filter(l => l.trim()).slice(0, 8);
      out += `\n${C.d}${C.i}╔ Neural Reflection\n`;
      lines.forEach(l => out += `║ ${l.slice(0,100)}\n`);
      out += `╚${C.r}\n`;
      continue;
    }
    if (!part.trim()) continue;
    let t = part;
    t = t.replace(/```tool\s*(\{[\s\S]*?\})\s*```/g, (_, json) => {
      try {
        const obj = JSON.parse(json);
        const nm = obj.name || 'tool';
        const summary = Object.entries(obj.args || {})
          .map(([k,v]) => { const vs = String(v); return `${k}=${vs.length>40?vs.slice(0,37)+'...':vs}`; })
          .join(' ');
        return `\n${C.yellow}⚡${C.r} ${C.b}${nm}${C.r}${summary ? ` ${C.gray}${summary}${C.r}` : ''}\n`;
      } catch { return `\n${C.yellow}⚡ TOOL${C.r}\n`; }
    });
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const label = lang || 'code';
      const bar = '─'.repeat(Math.max(0, 32-label.length));
      return `\n${C.gray}┌─ ${label} ${bar}${C.r}\n${C.bcyan}${code.trimEnd()}${C.r}\n${C.gray}└${'─'.repeat(34)}${C.r}\n`;
    });
    t = t.replace(/\*\*(.*?)\*\*/g, `${C.b}$1${C.r}`);
    t = t.replace(/`([^`]+)`/g, `${C.cyan}$1${C.r}`);
    t = t.replace(/^[*\-] (.+)/gm, `  ${C.yellow}•${C.r} $1`);
    t = t.replace(/^#{1,3} (.+)/gm, `\n${C.b}${C.bblue}$1${C.r}`);
    t = t.replace(/^> (.+)/gm, `  ${C.d}│ $1${C.r}`);
    t = t.replace(/\[AUTO_CONTINUE:\s*([^\]]+)\]/g, `\n${C.byellow}↺ Auto-continuing: $1${C.r}\n`);
    out += t;
  }
  return out;
}

// ─── Spinner with RGB animation ───────────────────────────────────────────────
class Spinner {
  constructor() {
    this._frame    = 0;
    this._interval = null;
    this._t0       = 0;
    this._tools    = 0;
    this._status   = '';
    this._tokens   = 0;
    this._dream    = false;
    this._effort   = 3;
  }

  start({ dream = false, effort = 3 } = {}) {
    this._t0     = Date.now();
    this._tools  = 0;
    this._status = '';
    this._tokens = 0;
    this._dream  = dream;
    this._effort = effort;
    this._frame  = 0;
    this._interval = setInterval(() => this._tick(), SPINNER_INTERVAL);
  }

  _tick() {
    const elapsedMs = Date.now() - this._t0;
    const elapsed   = (elapsedMs / 1000).toFixed(1);
    const frame     = SPINNER_FRAMES[this._frame++ % SPINNER_FRAMES.length];

    // Color: shimmer when idle, blue when active, red when stalled
    let spinColor;
    if (elapsedMs > STALL_THRESHOLD_MS) {
      const stallT = Math.min((elapsedMs - STALL_THRESHOLD_MS) / STALL_ANIMATION_MS, 1.0);
      const c = lerpRgb(THINKING_ACTIVE, STALL_COLOR, stallT);
      spinColor = rgb(c.r, c.g, c.b);
    } else if (this._tokens > 0 || this._tools > 0) {
      spinColor = rgb(THINKING_ACTIVE.r, THINKING_ACTIVE.g, THINKING_ACTIVE.b);
    } else {
      // shimmer between inactive and inactive-shimmer
      const shimT = (Math.sin((elapsedMs / SHIMMER_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      const c = lerpRgb(THINKING_INACTIVE, THINKING_INACTIVE_SHIMMER, shimT);
      spinColor = rgb(c.r, c.g, c.b);
    }

    const parts = [`${spinColor}${frame}${C.r}`];
    if (this._dream) parts.push(`${C.bmagenta}◈ dreaming${C.r}`);
    else parts.push(`${C.d}thinking...${C.r}`);
    parts.push(`${C.d}${elapsed}s${C.r}`);
    if (this._tokens > 0) parts.push(`${C.gray}~${fmtTokens(this._tokens)} tok${C.r}`);
    if (this._tools  > 0) parts.push(`${C.yellow}[${this._tools} tool${this._tools>1?'s':''}]${C.r}`);
    if (this._status)     parts.push(`${C.d}${this._status.slice(0,40)}${C.r}`);
    process.stdout.write('\r' + parts.join(' ') + '      ');
  }

  setStatus(s) { this._status = s; }
  addTool()    { this._tools++; this._status = ''; }
  addTokens(n) { this._tokens += n; }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    process.stdout.write('\r' + ' '.repeat(72) + '\r');
  }
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
  const w = 56;
  // Gradient title using RGB
  const title = '  ⬡  OmniShapeAgent';
  let gradTitle = '';
  for (let i = 0; i < title.length; i++) {
    const t2 = i / title.length;
    const c = lerpRgb({r:0,g:200,b:255}, {r:120,g:80,b:255}, t2);
    gradTitle += `${rgb(c.r,c.g,c.b)}${title[i]}`;
  }
  console.log(`\n${C.b}${C.d}${'━'.repeat(w)}${C.r}`);
  console.log(`${C.b}${gradTitle}${C.r}${C.b}  ${C.d}Autonomous AI Terminal${C.r}`);
  console.log(`${C.b}${C.d}${'━'.repeat(w)}${C.r}`);
  console.log(`${C.d}  Full computer access · Memory · Vision · Self-Improve · Bots${C.r}`);
  console.log(`${C.d}  /help for commands  ·  /setup for first-time config${C.r}\n`);
}

// ─── Status display ───────────────────────────────────────────────────────────
function printStatus(cfg, models, state) {
  const provIcon = { ollama:'🦙', vllm:'🔥', openrouter:'☁️', auto:'⚙' };
  console.log(`\n${C.b}${C.white}  ${provIcon[cfg.provider]||'⚙'}  Status${C.r}`);
  console.log(`  ${C.gray}Server   ${C.r} ${cfg.serverUrl}`);
  console.log(`  ${C.gray}Provider ${C.r} ${cfg.provider}`);
  console.log(`  ${C.gray}Model    ${C.r} ${C.b}${cfg.model || '(none)'}${C.r}`);
  if (cfg.companion) console.log(`  ${C.gray}Companion${C.r} ${cfg.companion}`);
  console.log(`  ${C.gray}Temp     ${C.r} ${cfg.temperature}  ${C.gray}Mode${C.r} ${cfg.synergyMode}  ${C.gray}Effort${C.r} ${cfg.effort}/5`);
  console.log(`  ${C.gray}Thinking ${C.r} ${cfg.thinkingMode}  ${C.gray}Budget${C.r} ${fmtTokens(cfg.thinkingBudget)} tok`);
  const flags = [
    cfg.fastMode  ? `${C.bgreen}fast${C.r}` : null,
    cfg.briefMode ? `${C.bcyan}brief${C.r}` : null,
    cfg.vimMode   ? `${C.yellow}vim${C.r}`  : null,
    cfg.dreamMode ? `${C.bmagenta}dream${C.r}` : null,
  ].filter(Boolean);
  if (flags.length) console.log(`  ${C.gray}Flags    ${C.r} ${flags.join('  ')}`);
  if (cfg.openrouterApiKey) console.log(`  ${C.gray}OR Key   ${C.r} ${C.d}sk-or-***${cfg.openrouterApiKey.slice(-4)}${C.r}`);
  if (models) {
    if (models.ollamaModels?.length)     console.log(`  ${C.bgreen}✓${C.r} ${C.gray}Ollama${C.r}     ${models.ollamaModels.length} models`);
    if (models.vllmModels?.length)       console.log(`  ${C.bgreen}✓${C.r} ${C.gray}vLLM${C.r}       ${models.vllmModels.length} models`);
    if (models.openrouterModels?.length) console.log(`  ${C.bgreen}✓${C.r} ${C.gray}OpenRouter${C.r} ${models.openrouterModels.length} models`);
  }
  if (state && state.sessionTurns > 0) {
    const uptime = Math.round((Date.now() - state.sessionStart) / 60000);
    console.log(`\n  ${C.gray}Session  ${C.r} ${state.sessionTurns} turns  ${uptime}m  ${fmtTokens(state.sessionInputTokens+state.sessionOutputTokens)} tokens  ${formatCost(state.sessionCost)}`);
  }
  console.log();
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function help(cfg) {
  const row = (cmd, desc) => `  ${C.yellow}${cmd.padEnd(38)}${C.r}${C.d}${desc}${C.r}`;
  const sec = (title) => `\n${C.b}${C.bwhite}${title}${C.r}`;
  console.log(`
${C.b}${C.bcyan}OmniShapeAgent Commands${C.r}

${sec('Configuration')}
${row('/setup',                       'Interactive setup wizard')}
${row('/status',                      'Connection, model, session info')}
${row('/model [name]',                'Get/set model (e.g. ollama:llama3.2)')}
${row('/companion [name]',            'Get/set companion model')}
${row('/provider [ollama|vllm|openrouter|auto]', 'Set inference provider')}
${row('/temp [0.0–2.0]',              'Get/set temperature')}
${row('/mode [off|parallel|neural]',  'Get/set synergy mode')}
${row('/effort [1-5]',                'Set thinking effort (1=fast, 5=ultra deep)')}
${row('/think [budget]',              'Enable thinking mode, optional token budget')}
${row('/dream [depth]',               'Dream mode: heavy latent-space reasoning')}
${row('/server [url]',                'Get/set server URL')}
${row('/key [sk-or-...]',             'Get/set OpenRouter API key')}
${row('/theme [dark|light|ocean|forest|sunset]', 'Switch color theme')}
${row('/fast',                        'Toggle fast mode (skip non-essential steps)')}
${row('/brief',                       'Toggle brief mode (shorter responses)')}
${row('/vim',                         'Toggle vim-style input mode')}
${row('/permissions',                 'Show what the agent is allowed to do')}
${row('/init [dir]',                  'Initialize OmniShapeAgent in a project dir')}

${sec('Conversation')}
${row('/reset',                       'Clear conversation history')}
${row('/history',                     'Show history with token + cost estimate')}
${row('/context',                     '40-char visual context window bar')}
${row('/compact',                     'Summarize history to shrink context')}
${row('/search <query>',              'Search input history')}
${row('/session list|save|load',      'Local session persistence')}
${row('/save [name]',                 'Save current chat to server')}
${row('/run <task>',                  'One-shot message')}
${row('/clear',                       'Clear terminal screen')}

${sec('Analysis')}
${row('/plan <task>',                 'Ask agent to create a step-by-step plan')}
${row('/review [file]',               'Ask agent to review code or last response')}
${row('/cost',                        'Show session cost breakdown')}
${row('/usage',                       'Show detailed token usage')}
${row('/stats',                       'Session statistics dashboard')}
${row('/diff <file>',                 'Show git diff for a file')}

${sec('Agent & Memory')}
${row('/memory',                      'Show memory stats and recent entries')}
${row('/tools',                       'List all agent tools (170+)')}
${row('/skills',                      'List available skills')}
${row('/selfimprove [depth]',         'Agent reads its own code and improves itself')}
${row('/learn',                       'Show self-improvement history')}
${row('/doctor',                      'Full diagnostics: server, models, memory, git')}

${sec('Bots & Vision')}
${row('/bots',                        'List deployed bots and scores')}
${row('/screen [file]',               'Take a screenshot')}
${row('/vision [prompt]',             'Describe what is on screen')}
${row('/watch [seconds]',             'Continuous screen monitoring')}
${row('/mouse x y [btn]',             'Move mouse and click')}
${row('/type <text>',                 'Type text via keyboard')}
${row('/presskey <key>',              'Press a keyboard key')}

${sec('Sharing')}
${row('/share',                       'Export conversation as shareable text')}
${row('/export [json|md|txt]',        'Export conversation to file')}
${row('/models',                      'List all models by provider')}
${row('/install',                     'Install CLI to system PATH')}
${row('/help',                        'Show this help')}
${row('/exit',                        'Save config and exit')}

${C.b}${C.bcyan}Keyboard Shortcuts${C.r}
  ${C.cyan}↑/↓${C.r}        Cycle command history
  ${C.cyan}Tab${C.r}         Complete slash commands
  ${C.cyan}Ctrl+C${C.r}      Cancel in-flight request (press twice to exit)
  ${C.cyan}\\${C.r} at EOL   Continue input on next line (multiline)

${C.b}${C.bcyan}Special Keywords${C.r}
  ${C.cyan}ultrathink${C.r}  Max thinking budget (32k tokens)
  ${C.cyan}deep think${C.r}  Deep thinking budget (16k tokens)
  ${C.cyan}think${C.r}       Enable thinking (8k tokens)

${C.b}${C.bcyan}Examples${C.r}
  ${C.d}•${C.r} ${C.cyan}OmniShapeAgent --run "refactor src/lib/agent.ts"${C.r}
  ${C.d}•${C.r} ${C.cyan}OmniShapeAgent --dream --run "design a new memory architecture"${C.r}
  ${C.d}•${C.r} ${C.cyan}cat README.md | OmniShapeAgent${C.r}
  ${C.d}•${C.r} ${C.cyan}OmniShapeAgent --server http://192.168.1.10:3000${C.r}
  ${C.d}•${C.r} Current model: ${C.b}${cfg?.model || '(none)'}${C.r}
`);
}

// ─── All tools list ───────────────────────────────────────────────────────────
const ALL_TOOLS = [
  'search_internet','fetch_url','extract_links','http_request','http_post',
  'run_terminal_command','run_python','run_js','spawn_subroutine',
  'read_file','write_file','append_file','patch_file','delete_file',
  'move_file','copy_file','create_dir','list_files','list_dir','file_exists',
  'zip_files','unzip_file',
  'grep_search','regex_match','diff_text','count_tokens',
  'json_format','strip_html','extract_json',
  'git_status','git_diff','git_log','git_add','git_commit',
  'git_clone','git_pull','git_push','git_branch','git_checkout',
  'git_blame','git_grep','git_stash','git_reset','git_show','git_init',
  'calculate','hash_text','base64_encode','base64_decode',
  'get_current_time','format_date','time_since','time_until',
  'system_info','set_env_key',
  'memory_store','memory_search','memory_prune','memory_boost',
  'memory_stats','memory_list','memory_consolidate','memory_search_tags',
  'graph_add','graph_query',
  'send_email','send_telegram','read_telegram',
  'schedule_cron','schedule_resonance','list_tasks','cancel_task',
  'install_npm','install_pip','install_cli','check_installed',
  'ensure_torch','check_torch',
  'read_skill','list_skills',
  'screenshot','get_screen_size','get_mouse_pos','mouse_move','mouse_click',
  'mouse_double_click','mouse_drag','mouse_scroll','keyboard_type',
  'keyboard_press','keyboard_hotkey','open_url','wait_ms',
  'describe_screen','analyze_image','find_on_screen','ocr_image',
  'map_screen','vision_sync','vision_tick','vision_watch','vision_reset',
  'screen_to_grid','screen_to_color_vector','grid_diff','screen_to_ascii',
  'tune_palette','save_palette_config','load_palette_config','list_palette_configs',
  'start_screen_monitor','stop_screen_monitor','is_monitor_running',
  'get_latest_frame','wait_for_change','capture_region','get_screen_diff',
  'deploy_bot','list_bots','stop_bot','update_bot_metric','is_bot_running',
  'train_bot','test_bot','improve_bot','analyze_bot_performance',
  'list_weights','get_best_weights','cleanup_weights','register_weights',
  'hall_of_fame','hof_enroll','hof_name','hof_retire','hof_strategies','hof_hallmark',
  'create_ui_window','close_ui_window','set_window_content_html',
  'edit_window_content_html','set_window_content_iframe','eval_in_window',
  'terminal_run','terminal_queue','terminal_pending','terminal_approve',
  'terminal_deny','terminal_clear',
  'meta_insights','meta_prompt','meta_sequences','meta_weak_tools',
  'get_user_profile','update_user_profile','profile_add_fact',
  'profile_add_goal','profile_complete_goal',
  'read_self','list_all_tools','diagnose_system','observe_self',
  'generate_image','cleanup_screenshots','prune_memories_auto',
  'self_improve','self_improve_apply','self_improve_history','self_improve_record',
  'add_hinge','set_motor','remove_hinge','spawn_creature','run_training_loop',
];

const SLASH_CMDS = [
  '/help','/setup','/status','/model','/companion','/provider','/temp','/mode',
  '/effort','/think','/dream','/server','/reset','/save','/run','/memory',
  '/tools','/skills','/bots','/install','/clear','/key','/history','/diff',
  '/models','/exit','/quit','/compact','/session','/context','/doctor',
  '/search','/selfimprove','/learn','/screen','/vision','/watch','/mouse',
  '/type','/presskey','/stats','/cost','/usage','/plan','/review',
  '/vim','/fast','/brief','/theme','/permissions','/share','/export','/init',
];

// ─── Streaming send ────────────────────────────────────────────────────────────
let _abortCurrentRequest = null;

async function send(userInput, cfg, history, state, opts = {}) {
  if (!cfg.model) {
    console.log(`${C.red}No model configured. Run /setup to configure a provider.${C.r}`);
    return null;
  }

  state.turnStart      = Date.now();
  state.turnInputTokens  = 0;
  state.turnOutputTokens = 0;
  state.turnToolCalls    = 0;
  state.streaming        = true;
  state.aborted          = false;

  const spinner = new Spinner();
  const isDream = opts.dream ?? cfg.dreamMode ?? false;
  const effort  = opts.effort ?? cfg.effort ?? 3;
  spinner.start({ dream: isDream, effort });

  // Determine thinking config
  const thinkKw    = detectThinkingKeyword(userInput);
  const thinkMode  = thinkKw?.mode ?? (isDream ? 'enabled' : cfg.thinkingMode);
  const thinkBudget = thinkKw?.budget ?? (isDream
    ? 32000
    : thinkingBudgetForEffort(effort));

  const mode = cfg.synergyMode;
  let toolCallCount = 0;
  let aborted = false;
  let activeReq = null;

  _abortCurrentRequest = () => {
    aborted = true;
    state.aborted = true;
    try { activeReq?.destroy(); } catch {}
    spinner.stop();
    console.log(`\n${C.byellow}  ↯ Request cancelled${C.r}\n`);
  };

  const payload = {
    message:          userInput,
    history:          history.filter(m => m.role !== 'system').slice(-cfg.maxHistory),
    model:            cfg.model,
    companionModel:   cfg.companion || undefined,
    temperature:      cfg.temperature,
    synergyMode:      mode,
    openrouterApiKey: cfg.openrouterApiKey || undefined,
    // Forward URL overrides so the server uses the same endpoints the CLI is configured for
    ollamaUrl:        cfg.ollamaUrl || undefined,
    vllmUrl:          cfg.vllmUrl   || undefined,
    thinkingMode:     thinkMode,
    thinkingBudget:   thinkBudget,
    dreamMode:        isDream,
    dreamDepth:       isDream ? (opts.dreamDepth ?? 3) : 0,
    effort:           effort,
    briefMode:        cfg.briefMode || false,
    fastMode:         cfg.fastMode  || false,
    contextWindow:    cfg.contextWindow,
    stream:           true,
  };

  let fullReply = '';
  let hasStartedOutput = false;
  let currentThought = '';
  let pendingAutoContinue = null;
  let tokenInfo = { input: 0, output: 0 };

  try {
    const { res, req } = await streamPost(cfg.serverUrl, '/api/agent', payload);
    activeReq = req;
    res.setEncoding('utf8');
    let lineBuffer = '';

    for await (const raw of res) {
      if (aborted) break;
      lineBuffer += raw;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let chunk; try { chunk = JSON.parse(line); } catch { continue; }

        if (chunk.type === 'status') {
          spinner.setStatus(chunk.content.slice(0, 50));

        } else if (chunk.type === 'thought') {
          if (!hasStartedOutput) {
            spinner.stop();
            const dreamTag = isDream ? ` ${C.bmagenta}◈ dream${C.r}` : '';
            const modeTag = mode !== 'off' ? ` ${C.magenta}[${mode}]${C.r}` : '';
            console.log(`\n${C.b}${C.bcyan}◆ OmniShapeAgent${C.r}${dreamTag}${modeTag}`);
            hasStartedOutput = true;
          }
          currentThought += chunk.content;
          const preview = chunk.content.replace(/\n/g,' ').slice(0, 65);
          process.stdout.write(`${C.d}${C.i}  ░ ${preview}${C.r}\r`);

        } else if (chunk.type === 'text') {
          if (!hasStartedOutput) {
            spinner.stop();
            const dreamTag = isDream ? ` ${C.bmagenta}◈ dream${C.r}` : '';
            const modeTag = mode !== 'off' ? ` ${C.magenta}[${mode}]${C.r}` : '';
            console.log(`\n${C.b}${C.bcyan}◆ OmniShapeAgent${C.r}${dreamTag}${modeTag}`);
            hasStartedOutput = true;
          } else if (currentThought) {
            process.stdout.write(' '.repeat(80) + '\r');
            const tLines = currentThought.split('\n').filter(l => l.trim()).slice(0, 5);
            console.log(`${C.d}${C.i}╔ Neural Reflection`);
            tLines.forEach(l => console.log(`║ ${l.slice(0,90)}`));
            console.log(`╚${C.r}`);
            currentThought = '';
          }
          extractAndShowFileDiffs(chunk.content);
          const tc = (chunk.content.match(/```tool/g) || []).length;
          if (tc > 0) { toolCallCount += tc; spinner.addTool(); }
          // Estimate output tokens from content
          const outTok = Math.ceil(chunk.content.length / 4);
          tokenInfo.output += outTok;
          spinner.addTokens(outTok);
          process.stdout.write(fmt(chunk.content));
          fullReply += chunk.content;

        } else if (chunk.type === 'tokens') {
          // If server sends token counts
          if (chunk.input)  tokenInfo.input  = chunk.input;
          if (chunk.output) tokenInfo.output = chunk.output;
          spinner.addTokens(chunk.output || 0);

        } else if (chunk.type === 'done') {
          spinner.stop();
          const elapsed = ((Date.now() - state.turnStart) / 1000).toFixed(1);
          if (!hasStartedOutput) {
            const dreamTag = isDream ? ` ${C.bmagenta}◈ dream${C.r}` : '';
            const modeTag = mode !== 'off' ? ` ${C.magenta}[${mode}]${C.r}` : '';
            console.log(`\n${C.b}${C.bcyan}◆ OmniShapeAgent${C.r}${dreamTag}${modeTag} ${C.d}(${elapsed}s)${C.r}`);
            if (chunk.content) { console.log(fmt(chunk.content)); fullReply = chunk.content; }
          } else {
            const tcStr = toolCallCount > 0 ? `  ${C.yellow}${toolCallCount} tool${toolCallCount>1?'s':''}${C.r}` : '';
            const tokStr = tokenInfo.output > 0 ? `  ${C.gray}~${fmtTokens(tokenInfo.output)} tok${C.r}` : '';
            const costEst = calcCost(tokenInfo.input, tokenInfo.output, cfg.provider);
            const costStr = costEst > 0 ? `  ${formatCost(costEst)}` : '';
            console.log(`\n${C.d}  ⏱  ${elapsed}s${C.r}${tcStr}${tokStr}${costStr}`);
          }
          if (chunk.autoContinue) pendingAutoContinue = chunk.autoContinue;

          // Update state
          state.turnInputTokens   = tokenInfo.input;
          state.turnOutputTokens  = tokenInfo.output;
          state.turnToolCalls     = toolCallCount;
          state.sessionInputTokens  += tokenInfo.input;
          state.sessionOutputTokens += tokenInfo.output;
          state.sessionToolCalls    += toolCallCount;
          state.sessionTurns++;
          state.sessionCost += calcCost(tokenInfo.input, tokenInfo.output, cfg.provider);

        } else if (chunk.type === 'error') {
          spinner.stop();
          if (!hasStartedOutput) { console.log(`\n${C.b}${C.bcyan}◆ OmniShapeAgent${C.r}`); hasStartedOutput = true; }
          console.log(`\n${C.red}⚠ ${chunk.content}${C.r}`);
          // Contextual hints for common errors
          if (chunk.content.includes('unreachable') || chunk.content.includes('endpoint paths failed')) {
            console.log(`${C.d}  → run /doctor to diagnose  ·  /model to switch provider${C.r}`);
          } else if (chunk.content.includes('auth') || chunk.content.includes('401') || chunk.content.includes('403')) {
            console.log(`${C.d}  → run /key to update your API key${C.r}`);
          }

        } else if (chunk.type === 'window') {
          const fn = {
            create:          c => `opened window "${c.id}"${c.title ? ` — ${c.title}` : ''}`,
            close:           c => `closed window "${c.id}"`,
            set_html:        c => `updated HTML in "${c.id}"`,
            set_iframe:      c => `opened iframe in "${c.id}"`,
            ensure_terminal: null,
            append_terminal: c => {
              if (c.content && c.content.trim()) {
                if (!hasStartedOutput) { spinner.stop(); hasStartedOutput = true; }
                process.stdout.write(`${C.gray}  │ ${c.content.replace(/\n/g,'\n  │ ')}${C.r}`);
              }
              return null;
            },
          }[chunk.op];
          if (fn === undefined) {
            console.log(`\n${C.gray}  ⬡ window:${chunk.op} "${chunk.id}"${C.r}`);
          } else if (typeof fn === 'function') {
            const msg = fn(chunk);
            if (msg) console.log(`\n${C.gray}  ⬡ ${msg}${C.r}`);
          }
        }
      }
    }
  } catch (e) {
    if (!aborted) {
      spinner.stop();
      console.log(`\n${C.red}Stream error: ${e.message}${C.r}`);
      console.log(`${C.d}  Is OmniShapeAgent running at ${cfg.serverUrl}? → npm run dev${C.r}\n`);
      _abortCurrentRequest = null;
      return null;
    }
  }

  spinner.stop();
  _abortCurrentRequest = null;
  state.streaming = false;
  console.log();
  return aborted ? null : { reply: fullReply, autoContinue: pendingAutoContinue };
}

// ─── Model auto-detection ─────────────────────────────────────────────────────
async function autoDetectModel(cfg) {
  try {
    const models = await api.get(cfg.serverUrl, '/api/models');
    if (cfg.provider === 'vllm' || (cfg.provider === 'auto' && models.vllmModels?.length)) {
      const m = models.vllmModels?.[0];
      if (m) { cfg.model = `vllm:${m.model}@${m.chatUrl||`http://${m.hostPort}/v1/chat/completions`}`; return models; }
    }
    if (cfg.provider === 'ollama' || (cfg.provider === 'auto' && models.ollamaModels?.length)) {
      const m = models.ollamaModels?.[0];
      if (m) { cfg.model = `ollama:${m}`; return models; }
    }
    if ((cfg.provider === 'openrouter' || cfg.provider === 'auto') && cfg.openrouterApiKey && models.openrouterModels?.length) {
      cfg.model = `openrouter:${models.openrouterModels[0].id}`; return models;
    }
    return models;
  } catch { return null; }
}

// ─── /setup wizard ────────────────────────────────────────────────────────────
async function runSetup(cfg, rl) {
  const ask = q => new Promise(res => rl.question(q, res));
  console.log(`\n${C.b}${C.bcyan}⬡ OmniShapeAgent Setup${C.r}\n`);

  console.log(`${C.b}Choose your inference provider:${C.r}`);
  ['1 Ollama     (local, free, runs on your machine)',
   '2 vLLM       (local cluster / OpenAI-compatible API)',
   '3 OpenRouter (cloud, requires API key)',
   '4 Auto       (use whatever is available)']
    .forEach(l => console.log(`  ${C.yellow}${l[0]}${C.r} ${l.slice(2)}`));

  const provChoice = await ask(`\n${C.yellow}Provider [1-4]:${C.r} `);
  cfg.provider = ({1:'ollama',2:'vllm',3:'openrouter',4:'auto'})[provChoice.trim()] || 'auto';

  if (cfg.provider === 'ollama') {
    const url = await ask(`${C.yellow}Ollama URL [${cfg.ollamaUrl}]:${C.r} `);
    if (url.trim()) cfg.ollamaUrl = url.trim();
    // Also set env-style URL override on model objects so the server knows
    try {
      const models = await api.get(cfg.serverUrl, '/api/models');
      if (models.ollamaModels?.length) {
        console.log(`\n${C.bgreen}Available Ollama models:${C.r}`);
        models.ollamaModels.forEach((m,i) => console.log(`  ${C.yellow}${i+1}${C.r} ${m}`));
        const pick = await ask(`${C.yellow}Select model [1]:${C.r} `);
        const idx = (parseInt(pick.trim())||1) - 1;
        cfg.model = `ollama:${models.ollamaModels[Math.max(0,Math.min(idx,models.ollamaModels.length-1))]}`;
      }
    } catch {}
    if (!cfg.model) {
      const m = await ask(`${C.yellow}Model name (e.g. llama3.2):${C.r} `);
      cfg.model = `ollama:${m.trim()||'llama3.2'}`;
    }
  } else if (cfg.provider === 'vllm') {
    const urlIn = await ask(`${C.yellow}vLLM URL [${cfg.vllmUrl}]:${C.r} `);
    if (urlIn.trim()) cfg.vllmUrl = urlIn.trim();
    // Normalize vllmUrl: ensure it has protocol
    if (cfg.vllmUrl && !cfg.vllmUrl.startsWith('http')) cfg.vllmUrl = `http://${cfg.vllmUrl}`;
    // Strip trailing path components — we want just http://host:port
    try { const u = new URL(cfg.vllmUrl); cfg.vllmUrl = u.origin; } catch {}

    let gotModelFromServer = false;
    try {
      const models = await api.get(cfg.serverUrl, '/api/models');
      if (models.vllmModels?.length) {
        console.log(`\n${C.bgreen}Available vLLM models:${C.r}`);
        models.vllmModels.forEach((m,i) => console.log(`  ${C.yellow}${i+1}${C.r} ${m.model} @ ${m.hostPort}`));
        const pick = await ask(`${C.yellow}Select model [1]:${C.r} `);
        const idx  = (parseInt(pick.trim())||1) - 1;
        const m    = models.vllmModels[Math.max(0,Math.min(idx,models.vllmModels.length-1))];
        // Prefer chatUrl from server, else embed cfg.vllmUrl so correct IP is always in the model string
        const resolvedUrl = m.chatUrl || (cfg.vllmUrl ? `${cfg.vllmUrl}/v1/chat/completions` : `http://${m.hostPort}/v1/chat/completions`);
        cfg.model = `vllm:${m.model}@${resolvedUrl}`;
        gotModelFromServer = true;
      }
    } catch {}
    if (!gotModelFromServer) {
      const m = await ask(`${C.yellow}Model name (e.g. Qwen2.5-72B):${C.r} `);
      const modelName = m.trim() || 'default';
      // Always embed the URL so the server never falls back to 127.0.0.1:8000
      const base = cfg.vllmUrl || 'http://127.0.0.1:8000';
      cfg.model = `vllm:${modelName}@${base}/v1/chat/completions`;
      console.log(`${C.bgreen}✓ Model set to:${C.r} ${cfg.model}`);
    }
  } else if (cfg.provider === 'openrouter') {
    const key = await ask(`${C.yellow}OpenRouter API key (sk-or-v1-...):${C.r} `);
    if (key.trim()) cfg.openrouterApiKey = key.trim();
    console.log(`\n${C.d}Fetching available models...${C.r}`);
    try {
      const models = await api.get(cfg.serverUrl, `/api/models?openrouterApiKey=${encodeURIComponent(cfg.openrouterApiKey)}`);
      if (models.openrouterModels?.length) {
        console.log(`\n${C.bgreen}Top OpenRouter models:${C.r}`);
        console.log(`  ${C.yellow}0${C.r} auto  ${C.d}Best Available${C.r}`);
        models.openrouterModels.slice(0,20).forEach((m,i) =>
          console.log(`  ${C.yellow}${i+1}${C.r} ${m.id}  ${C.d}${m.name}${C.r}`)
        );
        const pick = await ask(`${C.yellow}Select [0 for auto]:${C.r} `);
        const n = parseInt(pick.trim());
        if (!n || pick.trim() === '') cfg.model = 'openrouter:openrouter/auto';
        else { const m = models.openrouterModels[Math.max(0,Math.min(n-1,models.openrouterModels.length-1))]; cfg.model = `openrouter:${m.id}`; }
      }
    } catch {}
    if (!cfg.model) {
      const m = await ask(`${C.yellow}Model ID (or 'auto'):${C.r} `);
      const mv = m.trim(); cfg.model = `openrouter:${mv==='auto'?'openrouter/auto':(mv||'openrouter/auto')}`;
    }
  } else {
    console.log(`\n${C.d}Detecting available models...${C.r}`);
    await autoDetectModel(cfg);
    if (!cfg.model) console.log(`${C.byellow}⚠ No models found. Use /model to set manually.${C.r}`);
  }

  console.log(`\n${C.b}Synergy mode:${C.r}`);
  ['1 off      (single model — fastest)',
   '2 neural   (companion refines each response)',
   '3 parallel (two models debate the answer)']
    .forEach(l => console.log(`  ${C.yellow}${l[0]}${C.r} ${l.slice(2)}`));
  const modeChoice = await ask(`\n${C.yellow}Mode [1]:${C.r} `);
  cfg.synergyMode = ({2:'neural',3:'parallel'})[modeChoice.trim()] || 'off';

  const effort = await ask(`${C.yellow}Effort level 1-5 [${cfg.effort}] (3=balanced, 5=ultrathink):${C.r} `);
  if (effort.trim()) { const e = parseInt(effort); if (e >= 1 && e <= 5) { cfg.effort = e; cfg.thinkingBudget = thinkingBudgetForEffort(e); } }

  const t = await ask(`${C.yellow}Temperature [${cfg.temperature}]:${C.r} `);
  if (t.trim()) cfg.temperature = parseFloat(t) || cfg.temperature;

  saveConfig(cfg);
  console.log(`\n${C.bgreen}✓ Configuration saved${C.r}\n`);
  printStatus(cfg, null, null);
}

// ─── /install CLI ─────────────────────────────────────────────────────────────
async function installCli() {
  console.log(`\n${C.b}Installing OmniShapeAgent CLI to PATH...${C.r}`);
  try {
    const scriptDir = path.resolve(path.dirname(process.argv[1]), '..');
    const result = execSync('npm link', { cwd: scriptDir, encoding: 'utf8', stdio: 'pipe' });
    console.log(`${C.bgreen}✓ Installed.${C.r} ${C.d}${result.trim()}${C.r}`);
    try {
      const loc = execSync(process.platform === 'win32' ? 'where OmniShapeAgent' : 'which OmniShapeAgent', { encoding: 'utf8' }).trim();
      console.log(`${C.bgreen}✓ Available at:${C.r} ${loc}`);
      console.log(`${C.d}  Commands: ${C.cyan}OmniShapeAgent${C.r}${C.d}, ${C.cyan}oshape${C.r}${C.d}, ${C.cyan}shapagent${C.r}${C.d}${C.r}\n`);
    } catch { console.log(`${C.byellow}⚠ npm link succeeded — restart terminal to use.${C.r}\n`); }
  } catch (e) {
    console.log(`${C.red}✗ Install failed: ${e.message}${C.r}`);
    console.log(`${C.d}  Try: ${C.cyan}cd ${path.resolve(path.dirname(process.argv[1]),'..')} && npm link${C.r}\n`);
  }
}

// ─── History / Sessions ───────────────────────────────────────────────────────
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE))
      return fs.readFileSync(HISTORY_FILE,'utf8').split('\n').filter(Boolean).slice(-500);
  } catch {}
  return [];
}
function appendHistory(line) {
  try { fs.mkdirSync(CONFIG_DIR,{recursive:true}); fs.appendFileSync(HISTORY_FILE, line.replace(/\n/g,' ') + '\n'); } catch {}
}

function listSessions() {
  try {
    fs.mkdirSync(SESSIONS_DIR,{recursive:true});
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const p = path.join(SESSIONS_DIR, f);
        const stat = fs.statSync(p);
        let preview = '';
        try { const d = JSON.parse(fs.readFileSync(p,'utf8')); const first = (d.messages||[]).find(m=>m.role==='user'); if (first) preview = String(first.content).slice(0,60).replace(/\n/g,' '); } catch {}
        return { name: f.replace(/\.json$/,''), mtime: stat.mtime, preview };
      })
      .sort((a,b) => b.mtime - a.mtime);
  } catch { return []; }
}
function saveSession(name, history, cfg) {
  try {
    fs.mkdirSync(SESSIONS_DIR,{recursive:true});
    const safe = name.replace(/[^a-zA-Z0-9_\- ]/g,'_');
    const file = path.join(SESSIONS_DIR, `${safe}.json`);
    fs.writeFileSync(file, JSON.stringify({ name:safe, savedAt:new Date().toISOString(), model:cfg.model, messages:history }, null, 2));
    return file;
  } catch { return null; }
}
function loadSession(name) {
  try {
    const file = path.join(SESSIONS_DIR, name.endsWith('.json')?name:`${name}.json`);
    return JSON.parse(fs.readFileSync(file,'utf8')).messages || [];
  } catch { return null; }
}

// ─── Export helpers ───────────────────────────────────────────────────────────
function exportConversation(history, format, outputPath) {
  const msgs = history.filter(m => m.role !== 'system');
  let content = '';
  if (format === 'json') {
    content = JSON.stringify({ exportedAt: new Date().toISOString(), messages: msgs }, null, 2);
  } else if (format === 'md') {
    content = `# OmniShapeAgent Conversation\n_Exported: ${new Date().toLocaleString()}_\n\n`;
    msgs.forEach(m => {
      content += `## ${m.role === 'user' ? '▶ You' : '◆ OmniShapeAgent'}\n\n${m.content}\n\n---\n\n`;
    });
  } else {
    // txt
    msgs.forEach(m => {
      content += `[${m.role === 'user' ? 'YOU' : 'AGENT'}]\n${m.content}\n\n`;
    });
  }
  const file = outputPath || path.join(CONFIG_DIR, `export-${Date.now()}.${format}`);
  fs.writeFileSync(file, content);
  return file;
}

// ─── /stats ───────────────────────────────────────────────────────────────────
function printStats(state, cfg, history) {
  const uptime = Math.round((Date.now() - state.sessionStart) / 1000);
  const uptimeStr = uptime < 60 ? `${uptime}s` : uptime < 3600 ? `${Math.floor(uptime/60)}m ${uptime%60}s` : `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`;
  const totalTok = state.sessionInputTokens + state.sessionOutputTokens;
  const cost = state.sessionCost;
  const msgs = history.filter(m => m.role !== 'system');

  console.log(`\n${C.b}${C.bcyan}Session Statistics${C.r}`);
  console.log(`  ${C.gray}Uptime      ${C.r} ${uptimeStr}`);
  console.log(`  ${C.gray}Turns       ${C.r} ${C.b}${state.sessionTurns}${C.r}`);
  console.log(`  ${C.gray}Messages    ${C.r} ${msgs.length} in history`);
  console.log(`  ${C.gray}Tool calls  ${C.r} ${C.yellow}${state.sessionToolCalls}${C.r}`);
  console.log(`  ${C.gray}Tokens in   ${C.r} ~${fmtTokens(state.sessionInputTokens)}`);
  console.log(`  ${C.gray}Tokens out  ${C.r} ~${fmtTokens(state.sessionOutputTokens)}`);
  console.log(`  ${C.gray}Total tokens${C.r} ~${fmtTokens(totalTok)}`);
  console.log(`  ${C.gray}Cost        ${C.r} ${formatCost(cost)}`);
  console.log(`  ${C.gray}Model       ${C.r} ${cfg.model || '(none)'}`);
  console.log(`  ${C.gray}Provider    ${C.r} ${cfg.provider}  ${C.gray}Effort${C.r} ${cfg.effort}/5`);

  // Context fill bar
  const ctxSize = cfg.contextWindow || 128000;
  const ctxTok  = estimateTokens(msgs);
  const ctxPct  = Math.min(1, ctxTok / ctxSize);
  const BAR = 30;
  const filled = Math.round(ctxPct * BAR);
  const barStr = `${C.bgreen}${'█'.repeat(filled)}${C.d}${'░'.repeat(BAR-filled)}${C.r}`;
  const pctColor = ctxPct > 0.85 ? C.red : ctxPct > 0.6 ? C.byellow : C.bgreen;
  console.log(`  ${C.gray}Context     ${C.r} ${barStr} ${pctColor}${(ctxPct*100).toFixed(0)}%${C.r} ${C.d}(${fmtTokens(ctxTok)}/${fmtTokens(ctxSize)})${C.r}`);
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const argv    = process.argv.slice(2);
  const cfg     = loadConfig();
  const history = [];
  const state   = makeAppState();
  let mlBuf     = '';

  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i+1] : null; };
  const has  = name => argv.includes(name);

  if (flag('--server'))   cfg.serverUrl   = flag('--server');
  if (flag('--model'))    cfg.model       = flag('--model');
  if (flag('--temp'))     cfg.temperature = parseFloat(flag('--temp')) || cfg.temperature;
  if (flag('--mode'))     cfg.synergyMode = flag('--mode') || cfg.synergyMode;
  if (flag('--provider')) cfg.provider    = flag('--provider');
  if (flag('--effort'))   cfg.effort      = parseInt(flag('--effort')) || cfg.effort;
  if (has('--dream'))     cfg.dreamMode   = true;
  if (has('--fast'))      cfg.fastMode    = true;
  if (has('--brief'))     cfg.briefMode   = true;

  // ── Non-interactive / pipe mode ────────────────────────────────────────────
  const runArg  = flag('--run');
  const isPiped = !process.stdin.isTTY;

  if (runArg || isPiped) {
    let task = runArg || '';
    if (isPiped && !task) {
      const chunks = [];
      process.stdin.resume();
      for await (const c of process.stdin) chunks.push(c);
      task = Buffer.concat(chunks).toString().trim();
    }
    if (!task) { console.error('No task provided.'); process.exit(1); }
    if (!cfg.model) await autoDetectModel(cfg);
    if (!cfg.model) { console.error('No model available. Run: OmniShapeAgent /setup'); process.exit(1); }

    let current = task, continueCount = 0;
    const MAX_AUTO = 5;
    while (current && continueCount < MAX_AUTO) {
      const result = await send(current, cfg, history, state, { dream: cfg.dreamMode });
      if (!result) break;
      history.push({ role:'user', content:current });
      history.push({ role:'assistant', content:result.reply });
      if (result.autoContinue) { current = result.autoContinue; continueCount++; console.log(`${C.byellow}↺ Auto-continuing (${continueCount}/${MAX_AUTO})...${C.r}\n`); }
      else break;
    }
    saveConfig(cfg);
    return;
  }

  // ── Interactive mode ───────────────────────────────────────────────────────
  banner();

  let detectedModels = null;
  if (!cfg.model) {
    process.stdout.write(`${C.d}  Connecting to ${cfg.serverUrl}...${C.r}`);
    detectedModels = await autoDetectModel(cfg);
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    if (cfg.model) {
      console.log(`${C.bgreen}✓${C.r} ${C.b}${cfg.model}${C.r}`);
      if (cfg.companion) console.log(`${C.d}  companion: ${cfg.companion}${C.r}`);
    } else if (detectedModels === null) {
      console.log(`${C.red}✗ Cannot reach ${cfg.serverUrl}${C.r}`);
      console.log(`${C.d}  Start server: ${C.cyan}npm run dev${C.r}  or  ${C.cyan}/server <url>${C.r}\n`);
    } else {
      console.log(`${C.byellow}⚠ No models detected. Run ${C.cyan}/setup${C.r}${C.byellow} to configure.${C.r}`);
    }
  } else {
    console.log(`${C.bgreen}✓${C.r} ${C.b}${cfg.model}${C.r}`);
    if (cfg.companion) console.log(`${C.d}  companion: ${cfg.companion}${C.r}`);
  }

  const flags = [cfg.dreamMode&&'dream', cfg.fastMode&&'fast', cfg.briefMode&&'brief'].filter(Boolean);
  const flagStr = flags.length ? `  ${flags.map(f=>f==='dream'?`${C.bmagenta}dream${C.r}`:f==='fast'?`${C.bgreen}fast${C.r}`:`${C.bcyan}brief${C.r}`).join(' ')}` : '';
  console.log(`${C.d}  ${cfg.serverUrl}  ·  temp=${cfg.temperature}  ·  mode=${cfg.synergyMode}  ·  effort=${cfg.effort}/5${flagStr}${C.r}`);
  console.log(`${C.d}  /help for commands  ·  Ctrl+C cancels  ·  type "ultrathink" for max reasoning${C.r}\n`);

  // ── Cached model list for autocomplete ──────────────────────────────────────
  let _modelCache = { ollama: [], vllm: [], openrouter: [], loadedAt: 0 };
  async function refreshModelCache() {
    try {
      const models = await api.get(cfg.serverUrl, '/api/models');
      _modelCache = {
        ollama:      (models.ollamaModels     || []).map(m => `ollama:${m}`),
        vllm:        (models.vllmModels       || []).map(m => `vllm:${m.model}@${m.chatUrl || `http://${m.hostPort}/v1/chat/completions`}`),
        openrouter:  (models.openrouterModels || []).slice(0, 50).map(m => `openrouter:${m.id}`),
        loadedAt: Date.now(),
      };
    } catch {}
  }
  // Refresh model cache in the background at startup
  refreshModelCache().catch(() => {});

  // ── Contextual completer ──────────────────────────────────────────────────
  function completer(line) {
    // Slash commands: /cmd → complete command name
    if (line.startsWith('/')) {
      const parts = line.slice(1).split(' ');
      const cmd   = parts[0].toLowerCase();
      const rest  = parts.slice(1).join(' ');

      // If only typing the command itself (no space yet), complete the command name
      if (parts.length === 1) {
        const hits = SLASH_CMDS.filter(c => c.startsWith(line));
        return [hits.length ? hits : SLASH_CMDS, line];
      }

      // Contextual argument completion after command + space
      const prefix = rest;
      let candidates = [];

      if (cmd === 'model' || cmd === 'companion') {
        // /model <tab> → show all cached model IDs
        const allModels = [..._modelCache.ollama, ..._modelCache.vllm, ..._modelCache.openrouter];
        candidates = allModels.length ? allModels : ['ollama:', 'vllm:', 'openrouter:'];
      } else if (cmd === 'provider') {
        candidates = ['ollama', 'vllm', 'openrouter', 'auto'];
      } else if (cmd === 'mode') {
        candidates = ['off', 'neural', 'parallel'];
      } else if (cmd === 'effort') {
        candidates = ['1', '2', '3', '4', '5'];
      } else if (cmd === 'theme') {
        candidates = ['dark', 'light', 'ocean', 'forest', 'sunset'];
      } else if (cmd === 'dream') {
        candidates = ['1', '2', '3', 'on', 'off'];
      } else if (cmd === 'session') {
        if (!prefix || prefix === '') {
          candidates = ['list', 'save', 'load'];
        } else if (prefix.startsWith('load ') || prefix === 'load') {
          // Complete session names
          const sessions = listSessions().map(s => `load ${s.name}`);
          candidates = sessions.length ? sessions : ['load '];
        } else {
          candidates = ['list', 'save', 'load'];
        }
      } else if (cmd === 'export') {
        candidates = ['json', 'md', 'txt'];
      } else if (cmd === 'diff') {
        // File path completion — list files in cwd
        try {
          const dir  = prefix.includes('/') ? path.dirname(prefix) : '.';
          const base = prefix.includes('/') ? path.basename(prefix) : prefix;
          const entries = fs.readdirSync(dir).filter(f => f.startsWith(base));
          candidates = entries.map(e => {
            const full = path.join(dir, e);
            try { return fs.statSync(full).isDirectory() ? full + '/' : full; } catch { return full; }
          });
        } catch { candidates = []; }
      } else if (cmd === 'selfimprove') {
        candidates = ['standard', 'deep', 'full'];
      } else if (cmd === 'temp') {
        candidates = ['0.0', '0.1', '0.3', '0.5', '0.7', '0.8', '1.0', '1.2', '1.5'];
      } else if (cmd === 'server') {
        candidates = ['http://localhost:3000', 'http://127.0.0.1:3000'];
      } else if (cmd === 'think') {
        candidates = ['1000', '4000', '8000', '16000', '32000'];
      }

      const hits = candidates.filter(c => String(c).startsWith(prefix));
      const completions = hits.length ? hits : candidates;
      const fullLine = `/${cmd} ${prefix}`;
      return [completions.map(c => `/${cmd} ${c}`), fullLine];
    }
    return [[], line];
  }

  const persistedHistory = loadHistory();
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, terminal: true,
    prompt: `${C.b}${C.bblue}▶${C.r} `,
    completer,
    historySize: 500,
  });

  if (rl.history && persistedHistory.length)
    rl.history.push(...persistedHistory.slice().reverse());

  rl.prompt();

  rl.on('SIGINT', () => {
    if (_abortCurrentRequest) { _abortCurrentRequest(); }
    else { saveConfig(cfg); console.log(`\n${C.d}Goodbye.${C.r}\n`); process.exit(0); }
    rl.prompt();
  });

  rl.on('line', async line => {
    if (line.endsWith('\\')) { mlBuf += line.slice(0,-1) + '\n'; process.stdout.write(`${C.d}  ↩ ${C.r}`); return; }

    const input = (mlBuf + line).trim();
    mlBuf = '';
    if (!input) { rl.prompt(); return; }

    if (input.startsWith('/')) {
      const [rawCmd, ...rest] = input.slice(1).split(' ');
      const cmd = rawCmd.toLowerCase();
      const arg = rest.join(' ').trim();

      switch (cmd) {
        case 'help': help(cfg); break;

        case 'exit': case 'quit':
          saveConfig(cfg);
          console.log(`\n${C.d}Config saved. Goodbye.${C.r}\n`);
          rl.close(); process.exit(0);
          break;

        case 'clear':
          process.stdout.write('\x1B[2J\x1B[0f');
          banner();
          console.log(`${C.bgreen}✓${C.r} ${C.b}${cfg.model || '(no model)'}${C.r}\n`);
          break;

        case 'setup': await runSetup(cfg, rl); break;

        case 'status': {
          let models = null;
          try { models = await api.get(cfg.serverUrl, '/api/models'); } catch {}
          printStatus(cfg, models, state);
          break;
        }

        case 'stats': printStats(state, cfg, history); break;

        case 'cost': {
          const totalTok = state.sessionInputTokens + state.sessionOutputTokens;
          console.log(`\n${C.b}${C.bcyan}Cost Breakdown${C.r}`);
          console.log(`  ${C.gray}Provider   ${C.r} ${cfg.provider}`);
          console.log(`  ${C.gray}Input tok  ${C.r} ~${fmtTokens(state.sessionInputTokens)}  @ $${(COST_PER_1M_INPUT[cfg.provider]??1.50).toFixed(2)}/M`);
          console.log(`  ${C.gray}Output tok ${C.r} ~${fmtTokens(state.sessionOutputTokens)}  @ $${(COST_PER_1M_OUTPUT[cfg.provider]??2.00).toFixed(2)}/M`);
          console.log(`  ${C.gray}Total      ${C.r} ~${fmtTokens(totalTok)} tokens`);
          console.log(`  ${C.gray}Cost       ${C.r} ${formatCost(state.sessionCost)}`);
          if (cfg.provider === 'ollama' || cfg.provider === 'vllm')
            console.log(`  ${C.bgreen}  (local inference — no charge)${C.r}`);
          console.log();
          break;
        }

        case 'usage': {
          const msgs = history.filter(m => m.role !== 'system');
          const ctxTok = estimateTokens(msgs);
          const ctxSize = cfg.contextWindow || 128000;
          console.log(`\n${C.b}${C.bcyan}Token Usage${C.r}`);
          console.log(`  ${C.gray}Session in  ${C.r} ~${fmtTokens(state.sessionInputTokens)}`);
          console.log(`  ${C.gray}Session out ${C.r} ~${fmtTokens(state.sessionOutputTokens)}`);
          console.log(`  ${C.gray}Session tot ${C.r} ~${fmtTokens(state.sessionInputTokens+state.sessionOutputTokens)}`);
          console.log(`  ${C.gray}Context now ${C.r} ~${fmtTokens(ctxTok)} / ${fmtTokens(ctxSize)} (${((ctxTok/ctxSize)*100).toFixed(1)}%)`);
          console.log(`  ${C.gray}Turns       ${C.r} ${state.sessionTurns}  ${C.gray}Tools${C.r} ${state.sessionToolCalls}`);
          console.log();
          break;
        }

        case 'install': await installCli(); break;

        case 'reset':
          history.length = 0;
          console.log(`${C.bgreen}✓ History cleared.${C.r}`);
          break;

        case 'history': {
          const msgs = history.filter(m => m.role !== 'system');
          const tokens = estimateTokens(msgs);
          const cost = calcCost(Math.floor(tokens*0.6), Math.floor(tokens*0.4), cfg.provider);
          const costStr = (cfg.provider==='ollama'||cfg.provider==='vllm') ? `${C.bgreen}free (local)${C.r}` : formatCost(cost);
          console.log(`\n${C.b}Conversation:${C.r} ${msgs.length} messages  ~${fmtTokens(tokens)} tokens  ${costStr}`);
          msgs.slice(-6).forEach(m => {
            const icon = m.role==='user' ? `${C.bblue}▶${C.r}` : `${C.bcyan}◆${C.r}`;
            console.log(`  ${icon} ${String(m.content).slice(0,100).replace(/\n/g,' ')}${String(m.content).length>100?'…':''}`);
          });
          console.log();
          break;
        }

        case 'context': {
          const msgs = history.filter(m => m.role !== 'system');
          const tokens = estimateTokens(msgs);
          const ctxWindow = cfg.contextWindow || (cfg.provider==='ollama'?128000:cfg.provider==='vllm'?120000:256000);
          const pct = Math.min(1, tokens/ctxWindow);
          const BAR = 40;
          const filled = Math.round(pct*BAR);
          const bar = `${C.bgreen}${'█'.repeat(filled)}${C.r}${C.d}${'░'.repeat(BAR-filled)}${C.r}`;
          const color = pct>0.85?C.red:pct>0.6?C.byellow:C.bgreen;
          console.log(`\n${C.b}Context Window:${C.r}`);
          console.log(`  ${bar}  ${color}${(pct*100).toFixed(1)}%${C.r}`);
          console.log(`  ${C.gray}${fmtTokens(tokens)} / ${fmtTokens(ctxWindow)} tokens${C.r}  (${msgs.length} messages)`);
          if (pct > 0.7) console.log(`  ${C.byellow}⚠ Consider /compact to free context.${C.r}`);
          console.log();
          break;
        }

        case 'compact': {
          const msgs = history.filter(m => m.role !== 'system');
          if (msgs.length < 4) { console.log(`${C.d}Too short to compact (${msgs.length} messages).${C.r}`); break; }
          const tokensBefore = estimateTokens(msgs);
          console.log(`${C.d}Compacting ${msgs.length} messages (~${fmtTokens(tokensBefore)} tokens)...${C.r}`);
          const result = await send(
            'Produce a dense, structured summary of the conversation so far. Include: key decisions, files edited, tasks completed, current state, and open items. Be concise but complete. This replaces the full history.',
            cfg, msgs.slice(-20), state
          );
          if (result?.reply) {
            history.length = 0;
            history.push({ role:'user', content:'[Conversation compacted. Summary follows.]' });
            history.push({ role:'assistant', content:result.reply });
            console.log(`${C.bgreen}✓ Compacted: ${fmtTokens(tokensBefore)} → ~${fmtTokens(estimateTokens(history))} tokens${C.r}`);
          } else {
            console.log(`${C.red}✗ Compact failed — history unchanged.${C.r}`);
          }
          break;
        }

        case 'search': {
          if (!arg) { console.log(`${C.d}Usage: /search <query>${C.r}`); break; }
          const allLines = loadHistory();
          const q = arg.toLowerCase();
          const hits = allLines.filter(l => l.toLowerCase().includes(q)).slice(-20);
          if (!hits.length) { console.log(`${C.d}No matches for "${arg}".${C.r}`); }
          else {
            console.log(`\n${C.b}History matches for "${arg}":${C.r}`);
            hits.forEach((l,i) => {
              const hi = l.replace(new RegExp(`(${arg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), `${C.byellow}$1${C.r}`);
              console.log(`  ${C.gray}${i+1}.${C.r} ${hi.slice(0,120)}`);
            });
          }
          console.log();
          break;
        }

        case 'session': {
          const [sub, ...sessionRest] = (arg||'').split(' ');
          const sessionArg = sessionRest.join(' ').trim();
          if (!sub || sub === 'list') {
            const sessions = listSessions();
            if (!sessions.length) { console.log(`${C.d}No saved sessions. Use /session save [name].${C.r}`); }
            else {
              console.log(`\n${C.b}${C.bcyan}Saved Sessions:${C.r}`);
              sessions.forEach((s,i) => {
                const age = Math.round((Date.now()-s.mtime)/60000);
                const ageStr = age<60?`${age}m ago`:age<1440?`${Math.round(age/60)}h ago`:`${Math.round(age/1440)}d ago`;
                console.log(`  ${C.yellow}${(i+1).toString().padEnd(3)}${C.r} ${C.b}${s.name}${C.r}  ${C.d}${ageStr}  ${s.preview}${C.r}`);
              });
            }
            console.log();
          } else if (sub === 'save') {
            const name = sessionArg || `session-${new Date().toISOString().slice(0,16).replace('T','-').replace(/:/g,'')}`;
            const msgs = history.filter(m => m.role!=='system');
            if (!msgs.length) { console.log(`${C.d}Nothing to save.${C.r}`); break; }
            const file = saveSession(name, msgs, cfg);
            if (file) console.log(`${C.bgreen}✓ Saved: ${path.basename(file)}${C.r}  (${msgs.length} messages)`);
            else console.log(`${C.red}✗ Save failed.${C.r}`);
          } else if (sub === 'load') {
            if (!sessionArg) { console.log(`${C.d}Usage: /session load <name>${C.r}`); break; }
            const loaded = loadSession(sessionArg);
            if (!loaded) { console.log(`${C.red}✗ Session not found: ${sessionArg}${C.r}`); }
            else {
              history.length = 0;
              loaded.forEach(m => history.push(m));
              console.log(`${C.bgreen}✓ Loaded: ${sessionArg}${C.r}  (${loaded.length} messages, ~${fmtTokens(estimateTokens(loaded))} tokens)`);
            }
          } else { console.log(`${C.d}Usage: /session [list | save [name] | load <name>]${C.r}`); }
          break;
        }

        case 'plan': {
          const task = arg || 'the current goal';
          const prompt = `Create a detailed, step-by-step plan for: ${task}. Break into discrete tasks with clear dependencies. Estimate effort. Identify risks.`;
          appendHistory(prompt);
          await send(prompt, cfg, history, state);
          break;
        }

        case 'review': {
          const prompt = arg
            ? `Perform a thorough code review of ${arg}. Check for: correctness, security issues, performance, edge cases, and style.`
            : `Review the last response. Check for correctness, completeness, and any issues.`;
          appendHistory(prompt);
          await send(prompt, cfg, history, state);
          break;
        }

        case 'dream': {
          // Dream mode: enter heavy latent-space reasoning
          const prevDream = cfg.dreamMode;
          if (arg && !['on','off','1','2','3'].includes(arg)) {
            // /dream <task> — one-shot dream on this task
            console.log(`\n${C.bmagenta}◈ Dream Mode${C.r}  ${C.d}(max reasoning, latent-space exploration)${C.r}\n`);
            appendHistory(arg);
            await send(arg, cfg, history, state, { dream: true, dreamDepth: 3 });
          } else if (arg === 'off') {
            cfg.dreamMode = false; saveConfig(cfg);
            console.log(`${C.d}Dream mode disabled.${C.r}`);
          } else {
            const depth = parseInt(arg) || 3;
            cfg.dreamMode = true; cfg.thinkingMode = 'enabled';
            cfg.thinkingBudget = Math.min(32000, thinkingBudgetForEffort(Math.max(4, depth)));
            saveConfig(cfg);
            console.log(`\n${C.bmagenta}◈ Dream Mode ON${C.r}  ${C.d}depth=${depth}  budget=${fmtTokens(cfg.thinkingBudget)} tok${C.r}`);
            console.log(`${C.d}  All turns will use heavy latent-space reasoning. /dream off to disable.${C.r}\n`);
          }
          break;
        }

        case 'think': {
          // /think [budget]
          const budget = parseInt(arg) || 8000;
          cfg.thinkingMode = 'enabled';
          cfg.thinkingBudget = budget;
          saveConfig(cfg);
          console.log(`${C.bgreen}✓ Thinking enabled  ${C.gray}budget=${fmtTokens(budget)} tok${C.r}`);
          break;
        }

        case 'effort': {
          const n = parseInt(arg);
          if (n >= 1 && n <= 5) {
            cfg.effort = n;
            cfg.thinkingBudget = thinkingBudgetForEffort(n);
            cfg.thinkingMode = n >= 4 ? 'enabled' : 'adaptive';
            saveConfig(cfg);
            const label = ['','minimal','light','balanced','deep','ultra'][n];
            console.log(`${C.bgreen}✓ Effort: ${n}/5 (${label})  thinking budget: ${fmtTokens(cfg.thinkingBudget)} tok${C.r}`);
          } else {
            console.log(`\n${C.b}Effort Levels:${C.r}`);
            ['','1 minimal  — fast, no thinking',
             '2 light    — quick thinking (4k)',
             '3 balanced — standard thinking (8k)  ← default',
             '4 deep     — extended thinking (16k)',
             '5 ultra    — maximum thinking (32k, ultrathink)']
              .filter(Boolean).forEach(l => {
                const active = parseInt(l[0]) === cfg.effort;
                console.log(`  ${active ? C.bgreen : C.gray}${l}${active ? ' ←' : ''}${C.r}`);
              });
            console.log();
          }
          break;
        }

        case 'fast': cfg.fastMode = !cfg.fastMode; saveConfig(cfg); console.log(`${C.bgreen}✓ Fast mode: ${cfg.fastMode?'ON':'OFF'}${C.r}`); break;
        case 'brief': cfg.briefMode = !cfg.briefMode; saveConfig(cfg); console.log(`${C.bgreen}✓ Brief mode: ${cfg.briefMode?'ON':'OFF'}${C.r}`); break;
        case 'vim': cfg.vimMode = !cfg.vimMode; saveConfig(cfg); console.log(`${C.bgreen}✓ Vim mode: ${cfg.vimMode?'ON':'OFF'}${C.r}`); break;

        case 'theme': {
          const themes = {
            dark:   () => { /* default */ },
            light:  () => { C.r='\x1b[0m'; },
            ocean:  () => { },
            forest: () => { },
            sunset: () => { },
          };
          if (arg && themes[arg]) {
            cfg.theme = arg; saveConfig(cfg);
            console.log(`${C.bgreen}✓ Theme: ${arg}${C.r}  (restart CLI to fully apply)`);
          } else {
            const available = Object.keys(themes);
            console.log(`${C.b}Themes:${C.r} ${available.map(t => t===cfg.theme ? `${C.bgreen}${t}${C.r}` : t).join('  ')}`);
            console.log(`${C.d}Usage: /theme <name>${C.r}`);
          }
          break;
        }

        case 'permissions': {
          console.log(`\n${C.b}${C.bcyan}Agent Permissions${C.r}`);
          const perms = [
            ['File system',    'read, write, delete, move — full access'],
            ['Terminal',       'run commands, spawn processes'],
            ['Network',        'HTTP/HTTPS requests, search internet'],
            ['Screen/mouse',   'screenshot, vision, mouse/keyboard control'],
            ['Browser',        'open URLs, interact with web pages'],
            ['Git',            'status, diff, commit, push, pull, branch'],
            ['Email/Telegram', 'send messages (if configured)'],
            ['Python/JS',      'run_python, run_js — execute code'],
            ['Memory',         'store, search, consolidate agent memory'],
            ['Self-improve',   'read and patch own source code'],
          ];
          perms.forEach(([cat, desc]) => console.log(`  ${C.bgreen}✓${C.r} ${C.b}${cat.padEnd(16)}${C.r} ${C.d}${desc}${C.r}`));
          console.log(`\n  ${C.byellow}⚠  The agent can take real actions. Review requests carefully.${C.r}\n`);
          break;
        }

        case 'init': {
          const dir = arg ? path.resolve(arg) : process.cwd();
          console.log(`\n${C.b}Initializing OmniShapeAgent in:${C.r} ${dir}`);
          try {
            const agentFile = path.join(dir, '.shapagent.json');
            if (!fs.existsSync(agentFile)) {
              fs.writeFileSync(agentFile, JSON.stringify({ initialized: new Date().toISOString(), model: cfg.model, workdir: dir }, null, 2));
              console.log(`${C.bgreen}✓ Created .shapagent.json${C.r}`);
            } else { console.log(`${C.d}.shapagent.json already exists.${C.r}`); }
            const skillsDir = path.join(dir, 'skills');
            if (!fs.existsSync(skillsDir)) { fs.mkdirSync(skillsDir); console.log(`${C.bgreen}✓ Created skills/ directory${C.r}`); }
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          console.log();
          break;
        }

        case 'share': {
          const msgs = history.filter(m => m.role !== 'system');
          if (!msgs.length) { console.log(`${C.d}No conversation to share.${C.r}`); break; }
          let out = `OmniShapeAgent Conversation — ${new Date().toLocaleString()}\n${'═'.repeat(56)}\n\n`;
          msgs.forEach(m => {
            out += `${m.role === 'user' ? '▶ YOU' : '◆ AGENT'}\n${m.content}\n\n${'-'.repeat(40)}\n\n`;
          });
          const file = path.join(CONFIG_DIR, `share-${Date.now()}.txt`);
          fs.writeFileSync(file, out);
          console.log(`${C.bgreen}✓ Saved to:${C.r} ${file}`);
          try { execSync(process.platform==='win32'?`start "" "${file}"`:process.platform==='darwin'?`open "${file}"`:process.platform==='linux'?`xdg-open "${file}"`:''+'', {stdio:'ignore'}); } catch {}
          break;
        }

        case 'export': {
          const format = (['json','md','txt'].includes(arg)) ? arg : 'md';
          const msgs = history.filter(m => m.role !== 'system');
          if (!msgs.length) { console.log(`${C.d}No conversation to export.${C.r}`); break; }
          try {
            const file = exportConversation(history, format, null);
            console.log(`${C.bgreen}✓ Exported (${format}):${C.r} ${file}`);
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;
        }

        case 'selfimprove': {
          if (!cfg.model) { console.log(`${C.red}No model configured. Run /setup first.${C.r}`); break; }
          const depth = arg || 'standard';
          const siFiles = [
            'src/lib/agent.ts','src/lib/vector-store.ts','src/lib/memory-consolidator.ts',
            'src/lib/meta-learner.ts','src/lib/user-profile.ts','src/lib/self-improve.ts',
          ].filter(f => { try { return require('fs').existsSync(require('path').join(process.cwd(),f)); } catch { return false; } });
          const prompt = `Trigger self-improvement mode. Files to analyze: ${siFiles.join(', ')}. Use the self_improve tool with mode="${depth}" to read, analyze, and improve your own source code. Look for bugs, performance issues, cognitive improvements, and missing learning integrations. Apply the 3 highest-severity improvements directly. Document all findings.`;
          console.log(`\n${C.bcyan}⬡ Self-Improve Mode${C.r}  ${C.d}(${depth})${C.r}`);
          console.log(`${C.d}  Analyzing ${siFiles.length} source files...${C.r}\n`);
          appendHistory(prompt);
          await send(prompt, cfg, history, state);
          break;
        }

        case 'learn': {
          try {
            const data = await api.get(cfg.serverUrl, '/api/self-improve/stats').catch(() => null);
            if (data && data.totalSessions !== undefined) {
              console.log(`\n${C.b}${C.bcyan}Self-Improvement History${C.r}`);
              console.log(`  Sessions    : ${C.b}${data.totalSessions}${C.r}`);
              console.log(`  Improvements: ${C.b}${data.totalImprovements}${C.r}  applied:${C.bgreen}${data.applied}${C.r}  pending:${C.byellow}${data.pending}${C.r}`);
              if (data.bySeverity) {
                const {critical=0,major=0,minor=0} = data.bySeverity;
                console.log(`  Severity    : ${C.red}${critical} critical${C.r}  ${C.byellow}${major} major${C.r}  ${C.d}${minor} minor${C.r}`);
              }
              if (data.lastSessionAt) {
                const age = Math.round((Date.now()-data.lastSessionAt)/60000);
                console.log(`  Last run    : ${C.d}${age<60?`${age}m ago`:`${Math.round(age/60)}h ago`}${C.r}`);
              }
            } else { console.log(`${C.d}No self-improvement history yet. Run /selfimprove.${C.r}`); }
            console.log();
          } catch (e) { console.log(`${C.d}Self-improve stats unavailable (${e.message}).${C.r}`); }
          break;
        }

        case 'doctor': {
          console.log(`\n${C.b}${C.bcyan}Diagnostics${C.r}\n`);
          try {
            const health = await api.get(cfg.serverUrl, '/api/health');
            console.log(`  ${C.bgreen}✓${C.r} Server      ${cfg.serverUrl}  ${C.d}${JSON.stringify(health).slice(0,60)}${C.r}`);
          } catch (e) { console.log(`  ${C.red}✗${C.r} Server      ${cfg.serverUrl}  ${C.red}${e.message}${C.r}`); }
          if (cfg.model) console.log(`  ${C.bgreen}✓${C.r} Model       ${cfg.model}  ${C.d}effort=${cfg.effort}/5${C.r}`);
          else console.log(`  ${C.byellow}⚠${C.r} Model       not configured — run /setup`);
          if (cfg.provider === 'openrouter' || cfg.provider === 'auto') {
            if (cfg.openrouterApiKey) console.log(`  ${C.bgreen}✓${C.r} OR Key      sk-or-***${cfg.openrouterApiKey.slice(-4)}`);
            else console.log(`  ${C.byellow}⚠${C.r} OR Key      not set`);
          }
          try {
            const models = await api.get(cfg.serverUrl, '/api/models');
            const total = (models.ollamaModels?.length||0)+(models.vllmModels?.length||0)+(models.openrouterModels?.length||0);
            console.log(`  ${C.bgreen}✓${C.r} Models      ${total} (ollama:${models.ollamaModels?.length||0} vllm:${models.vllmModels?.length||0} or:${models.openrouterModels?.length||0})`);
          } catch { console.log(`  ${C.red}✗${C.r} Models      could not fetch`); }
          try {
            const mem = await api.get(cfg.serverUrl, '/api/memory');
            const s = mem.stats || {};
            console.log(`  ${C.bgreen}✓${C.r} Memory      ${s.totalMemories??0} entries  ${s.totalEntities??0} entities`);
          } catch { console.log(`  ${C.byellow}⚠${C.r} Memory      API not reachable`); }
          const ctxTok = estimateTokens(history.filter(m=>m.role!=='system'));
          const ctxSize = cfg.contextWindow || 128000;
          console.log(`  ${C.bgreen}✓${C.r} Context     ~${fmtTokens(ctxTok)} tokens (${((ctxTok/ctxSize)*100).toFixed(1)}% of ${fmtTokens(ctxSize)})`);
          try {
            fs.mkdirSync(SESSIONS_DIR,{recursive:true});
            const count = fs.readdirSync(SESSIONS_DIR).filter(f=>f.endsWith('.json')).length;
            console.log(`  ${C.bgreen}✓${C.r} Sessions    ${count} saved`);
          } catch { console.log(`  ${C.d}–${C.r} Sessions    ${SESSIONS_DIR}`); }
          try {
            const branch = execSync('git rev-parse --abbrev-ref HEAD', {encoding:'utf8',stdio:'pipe'}).trim();
            const dirty = execSync('git status --porcelain', {encoding:'utf8',stdio:'pipe'}).trim();
            console.log(`  ${C.bgreen}✓${C.r} Git         branch:${branch}${dirty?` ${C.byellow}(dirty)${C.r}`:''}`);
          } catch { console.log(`  ${C.d}–${C.r} Git         not a git repo`); }
          // Node version
          console.log(`  ${C.bgreen}✓${C.r} Node        ${process.version}`);
          console.log();
          break;
        }

        case 'model':
          if (arg) { cfg.model = arg; saveConfig(cfg); console.log(`${C.bgreen}✓ Model: ${arg}${C.r}`); }
          else console.log(`${C.cyan}Model: ${C.b}${cfg.model||'(none)'}${C.r}`);
          break;

        case 'companion':
          if (arg) { cfg.companion = arg; saveConfig(cfg); console.log(`${C.bgreen}✓ Companion: ${arg}${C.r}`); }
          else console.log(`${C.cyan}Companion: ${C.b}${cfg.companion||'(none)'}${C.r}`);
          break;

        case 'provider':
          if (['ollama','vllm','openrouter','auto'].includes(arg)) {
            cfg.provider = arg; saveConfig(cfg); console.log(`${C.bgreen}✓ Provider: ${arg}${C.r}`);
          } else console.log(`${C.cyan}Provider: ${cfg.provider}  Options: ollama|vllm|openrouter|auto${C.r}`);
          break;

        case 'temp':
          if (arg) {
            const t = parseFloat(arg);
            if (!isNaN(t) && t >= 0 && t <= 2) { cfg.temperature = t; saveConfig(cfg); console.log(`${C.bgreen}✓ Temp: ${t}${C.r}`); }
            else console.log(`${C.red}Temperature must be 0.0–2.0${C.r}`);
          } else console.log(`${C.cyan}Temperature: ${cfg.temperature}${C.r}`);
          break;

        case 'mode':
          if (['off','parallel','neural'].includes(arg)) { cfg.synergyMode = arg; saveConfig(cfg); console.log(`${C.bgreen}✓ Mode: ${arg}${C.r}`); }
          else console.log(`${C.cyan}Mode: ${cfg.synergyMode}  Options: off|parallel|neural${C.r}`);
          break;

        case 'server':
          if (arg) { cfg.serverUrl = arg; saveConfig(cfg); console.log(`${C.bgreen}✓ Server: ${arg}${C.r}`); }
          else console.log(`${C.cyan}Server: ${cfg.serverUrl}${C.r}`);
          break;

        case 'key': case 'apikey':
          if (arg && (arg.startsWith('sk-or')||arg.startsWith('sk-'))) {
            cfg.openrouterApiKey = arg; saveConfig(cfg);
            console.log(`${C.bgreen}✓ OpenRouter key saved (sk-or-***${arg.slice(-4)})${C.r}`);
          } else if (cfg.openrouterApiKey) {
            console.log(`${C.cyan}OpenRouter key: sk-or-***${cfg.openrouterApiKey.slice(-4)}${C.r}`);
          } else { console.log(`${C.d}No key set. Usage: /key sk-or-v1-...${C.r}`); }
          break;

        case 'memory': {
          // /memory               → stats
          // /memory search <q>    → semantic+text search
          // /memory recent [N]    → N most recent
          // /memory important [N] → N highest importance
          // /memory add <text>    → store a new memory
          // /memory pin <id>      → boost importance +0.5
          // /memory forget <id>   → delete by id
          // /memory tag <tags>    → filter by tags (comma-sep)
          const [subCmd, ...subArgs] = (arg||'').split(' ').filter(Boolean);
          try {
            if (!subCmd || subCmd === 'stats') {
              const mem = await api.get(cfg.serverUrl, '/api/memory?action=stats');
              const s = mem.memory || {};
              const g = mem.graph || {};
              console.log(`\n${C.b}${C.bcyan}Memory${C.r}`);
              console.log(`  Entries   : ${C.b}${s.totalMemories??0}${C.r}  (${C.d}avg importance ${(s.avgImportance??0).toFixed(2)}${C.r})`);
              console.log(`  Entities  : ${C.b}${g.entities??0}${C.r}`);
              console.log(`  Relations : ${C.b}${g.relations??0}${C.r}`);
              if (g.topEntities?.length) {
                console.log(`\n${C.d}Top entities:${C.r}`);
                g.topEntities.slice(0,6).forEach(e => console.log(`  ${C.d}•${C.r} ${e.label} ${C.d}[${e.type}] ×${e.mentions}${C.r}`));
              }
              console.log(`\n${C.d}Usage: /memory search <query>  /memory recent  /memory important  /memory add <text>  /memory pin <id>  /memory forget <id>${C.r}\n`);
            } else if (subCmd === 'search') {
              const q = subArgs.join(' ');
              if (!q) { console.log(`${C.d}Usage: /memory search <query>${C.r}`); break; }
              const res = await api.get(cfg.serverUrl, `/api/memory?q=${encodeURIComponent(q)}&limit=10`);
              if (!res.results?.length) { console.log(`${C.d}No results for "${q}"${C.r}`); break; }
              console.log(`\n${C.b}${C.bcyan}Memory search: ${q}${C.r}`);
              res.results.forEach((r, i) => {
                const score = r.score != null ? ` ${C.d}score=${r.score.toFixed(2)}${C.r}` : '';
                const imp   = ` ${C.d}imp=${r.importance?.toFixed(2)??'?'}${C.r}`;
                console.log(`  ${C.yellow}${(i+1).toString().padStart(2)}.${C.r} [${C.d}${r.id.slice(0,8)}${C.r}]${score}${imp}`);
                console.log(`     ${String(r.content).substring(0,110)}`);
              });
              console.log();
            } else if (subCmd === 'recent') {
              const n = parseInt(subArgs[0]) || 10;
              const res = await api.get(cfg.serverUrl, `/api/memory?action=recent&limit=${n}`);
              console.log(`\n${C.b}${C.bcyan}Recent memories (${res.total??0})${C.r}`);
              (res.records||[]).forEach((r, i) => {
                const ts = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
                console.log(`  ${C.yellow}${(i+1).toString().padStart(2)}.${C.r} [${C.d}${r.id.slice(0,8)}${C.r}] ${C.d}${ts}${C.r}`);
                console.log(`     ${String(r.content).substring(0,110)}`);
              });
              console.log();
            } else if (subCmd === 'important') {
              const n = parseInt(subArgs[0]) || 10;
              const res = await api.get(cfg.serverUrl, `/api/memory?action=important&limit=${n}`);
              console.log(`\n${C.b}${C.bcyan}Important memories (${res.total??0})${C.r}`);
              (res.records||[]).forEach((r, i) => {
                console.log(`  ${C.yellow}${(i+1).toString().padStart(2)}.${C.r} [${C.d}${r.id.slice(0,8)}${C.r}] ${C.bgreen}imp=${r.importance?.toFixed(2)??'?'}${C.r}`);
                console.log(`     ${String(r.content).substring(0,110)}`);
              });
              console.log();
            } else if (subCmd === 'add') {
              const text = subArgs.join(' ');
              if (!text) { console.log(`${C.d}Usage: /memory add <text>${C.r}`); break; }
              const res = await fetch(`${cfg.serverUrl}/api/memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text, importance: 1.0, source: 'cli' }),
              }).then(r => r.json());
              if (res.ok) console.log(`${C.bgreen}✓ Stored [${res.id?.slice(0,8)}]: ${text.substring(0,70)}${C.r}`);
              else console.log(`${C.red}✗ ${res.error||'failed'}${C.r}`);
            } else if (subCmd === 'pin') {
              const id = subArgs[0];
              if (!id) { console.log(`${C.d}Usage: /memory pin <id>${C.r}`); break; }
              const res = await fetch(`${cfg.serverUrl}/api/memory?id=${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boost: 0.5 }),
              });
              if (!res.ok) throw new Error(`pin failed (${res.status})`);
              console.log(`${C.bgreen}✓ Boosted importance for [${id.slice(0,8)}]${C.r}`);
            } else if (subCmd === 'forget') {
              const id = subArgs[0];
              if (!id) { console.log(`${C.d}Usage: /memory forget <id>${C.r}`); break; }
              const res = await fetch(`${cfg.serverUrl}/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
              if (!res.ok) throw new Error(`delete failed (${res.status})`);
              console.log(`${C.byellow}✓ Deleted [${id.slice(0,8)}]${C.r}`);
            } else if (subCmd === 'tag') {
              const tags = subArgs.join(' ');
              if (!tags) { console.log(`${C.d}Usage: /memory tag <tag1,tag2>${C.r}`); break; }
              const res = await api.get(cfg.serverUrl, `/api/memory?action=tags&tags=${encodeURIComponent(tags)}`);
              console.log(`\n${C.b}${C.bcyan}Tag filter: ${tags}${C.r}`);
              (res.records||[]).forEach((r, i) => {
                console.log(`  ${C.yellow}${(i+1).toString().padStart(2)}.${C.r} [${C.d}${r.id.slice(0,8)}${C.r}] ${C.d}${(r.tags||[]).join(',')}${C.r}`);
                console.log(`     ${String(r.content).substring(0,110)}`);
              });
              if (!res.records?.length) console.log(`${C.d}No results.${C.r}`);
              console.log();
            } else {
              console.log(`${C.d}Sub-commands: stats, search <q>, recent [N], important [N], add <text>, pin <id>, forget <id>, tag <tags>${C.r}`);
            }
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;
        }

        case 'tools':
          console.log(`\n${C.b}${C.bcyan}Tools (${ALL_TOOLS.length}):${C.r}`);
          for (let i = 0; i < ALL_TOOLS.length; i += 4)
            console.log(`  ${C.yellow}${ALL_TOOLS.slice(i,i+4).map(t=>t.padEnd(32)).join('')}${C.r}`);
          console.log();
          break;

        case 'skills':
          try {
            const { body } = await makeRequest(cfg.serverUrl, '/api/agent', 'POST', { message:'list_skills_internal_cmd', history:[], model:cfg.model, temperature:0, synergyMode:'off', stream:false });
            if (body.reply) console.log(fmt(body.reply));
            else console.log(`${C.d}Ask the agent: "what skills do you have?"${C.r}`);
          } catch { console.log(`${C.d}Ask the agent: "what skills do you have?"${C.r}`); }
          break;

        case 'bots':
          try {
            const bots = await api.get(cfg.serverUrl, '/api/bots');
            const list = Array.isArray(bots)?bots:(bots.bots||[]);
            if (!list.length) { console.log(`${C.d}No deployed bots.${C.r}`); break; }
            console.log(`\n${C.b}${C.bcyan}Deployed Bots:${C.r}`);
            list.forEach(b => {
              const score = b.metrics?.score ?? b.score ?? '?';
              const sc = b.status==='running'?C.bgreen:b.status==='stopped'?C.red:C.gray;
              console.log(`  ${sc}●${C.r} ${C.b}${b.id}${C.r}  ${C.d}${(b.goal||'').slice(0,50)}${C.r}  score=${score}`);
            });
            console.log();
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;

        case 'save':
          try {
            const name = arg || `cli-${new Date().toISOString().slice(0,16).replace('T',' ')}`;
            const res = await api.post(cfg.serverUrl, '/api/chats', { name, messages:history });
            console.log(`${C.bgreen}✓ Saved: ${name}${res.id?` (${res.id})`:''}.${C.r}`);
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;

        case 'models': {
          try {
            const params = new URLSearchParams();
            if (cfg.ollamaUrl) params.set('ollamaUrl', cfg.ollamaUrl);
            if (cfg.vllmUrl) params.set('vllmUrl', cfg.vllmUrl);
            if (cfg.openrouterApiKey) params.set('openrouterApiKey', cfg.openrouterApiKey);
            const data = await api.get(cfg.serverUrl, `/api/models?${params}`);
            const ollama = Array.isArray(data.ollamaModels)?data.ollamaModels:[];
            const vllm = Array.isArray(data.vllmModels)?data.vllmModels:[];
            const or = Array.isArray(data.openrouterModels)?data.openrouterModels:[];
            console.log(`\n${C.b}${C.bcyan}Available Models${C.r}`);
            if (ollama.length) { console.log(`\n${C.yellow}Ollama (${ollama.length}):${C.r}`); ollama.forEach(m => console.log(`  ${C.d}•${C.r} ollama:${m}${cfg.model===`ollama:${m}`?` ${C.bgreen}← active${C.r}`:''}`)); }
            if (vllm.length) { console.log(`\n${C.yellow}vLLM (${vllm.length}):${C.r}`); vllm.forEach(m => console.log(`  ${C.d}•${C.r} vllm:${m.model}${cfg.model?.includes(m.model)?` ${C.bgreen}← active${C.r}`:''} ${C.d}@ ${m.hostPort}${C.r}`)); }
            if (or.length) { console.log(`\n${C.yellow}OpenRouter (${or.length}):${C.r}`); or.slice(0,30).forEach(m => console.log(`  ${C.d}•${C.r} openrouter:${m.id}${cfg.model===`openrouter:${m.id}`?` ${C.bgreen}← active${C.r}`:''} ${C.d}${m.name}${C.r}`)); if (or.length>30) console.log(`  ${C.d}... and ${or.length-30} more${C.r}`); }
            if (!ollama.length && !vllm.length && !or.length) console.log(`  ${C.red}No models found — check server and API keys${C.r}`);
            console.log();
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;
        }

        case 'screen': case 'screenshot': {
          try {
            const out = arg || `workspace/cli_screen_${Date.now()}.png`;
            const { body: data } = await makeRequest(cfg.serverUrl, '/api/agent', 'POST', { message:`Take a screenshot and save it to ${out}, then return just the file path.`, history:[], model:cfg.model, stream:false, openrouterApiKey:cfg.openrouterApiKey });
            const reply = data.reply||'';
            const match = reply.match(/screenshots?\/[^\s'"]+\.png|workspace\/[^\s'"]+\.png/i);
            const imgPath = match?match[0]:out;
            console.log(`${C.bgreen}✓ Screenshot:${C.r} ${imgPath}`);
            try { execSync(`start "" "${path.resolve(imgPath)}"`, {stdio:'ignore'}); } catch {}
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;
        }

        case 'vision': {
          const prompt = arg || 'Describe what you currently see on the screen in detail.';
          appendHistory(prompt);
          await send(prompt, cfg, history, state);
          break;
        }

        case 'watch': {
          const seconds = parseInt(arg)||3;
          console.log(`${C.bcyan}👁  Watching screen every ${seconds}s — Ctrl+C to stop${C.r}`);
          let watchActive = true;
          const stopWatch = () => { watchActive = false; };
          const prevAbort = _abortCurrentRequest;
          _abortCurrentRequest = stopWatch;
          while (watchActive) {
            try {
              const { body } = await makeRequest(cfg.serverUrl, '/api/agent', 'POST', { message:'Take a screenshot and save to workspace/watch_frame.png, return just the path.', history:[], model:cfg.model, stream:false, openrouterApiKey:cfg.openrouterApiKey });
              const match = (body.reply||'').match(/workspace\/[^\s'"]+\.png/i);
              if (match) console.log(`${C.d}[${new Date().toLocaleTimeString()}]${C.r} ${C.cyan}frame:${C.r} ${match[0]}`);
            } catch {}
            await new Promise(r => setTimeout(r, seconds*1000));
          }
          _abortCurrentRequest = prevAbort;
          console.log(`${C.d}Watch stopped.${C.r}`);
          break;
        }

        case 'mouse': {
          const parts = (arg||'').split(/\s+/).filter(Boolean);
          if (parts.length < 2) { console.log(`${C.d}Usage: /mouse x y [left|right|middle]${C.r}`); break; }
          const [x, y, btn='left'] = parts;
          const prompt = `Move mouse to (${x}, ${y}) and click ${btn} button.`;
          appendHistory(prompt); await send(prompt, cfg, history, state);
          break;
        }

        case 'type': {
          if (!arg) { console.log(`${C.d}Usage: /type <text>${C.r}`); break; }
          const prompt = `Type the following text using the keyboard: "${arg}"`;
          appendHistory(prompt); await send(prompt, cfg, history, state);
          break;
        }

        case 'presskey': {
          if (!arg) { console.log(`${C.d}Usage: /presskey <key>${C.r}`); break; }
          const kpPrompt = `Press the keyboard key: ${arg}`;
          appendHistory(kpPrompt); await send(kpPrompt, cfg, history, state);
          break;
        }

        case 'diff': {
          if (!arg) { console.log(`${C.d}Usage: /diff <file>${C.r}`); break; }
          try {
            const abs = path.resolve(arg);
            if (!fs.existsSync(abs)) { console.log(`${C.red}File not found: ${arg}${C.r}`); break; }
            try {
              const gitDiff = execSync(`git diff HEAD -- "${abs}"`, {encoding:'utf8',stdio:['pipe','pipe','pipe']});
              if (!gitDiff.trim()) { console.log(`${C.d}No changes vs HEAD in ${arg}${C.r}`); }
              else gitDiff.split('\n').forEach(l => {
                if (l.startsWith('+')&&!l.startsWith('+++')) console.log(`${C.bgreen}${l}${C.r}`);
                else if (l.startsWith('-')&&!l.startsWith('---')) console.log(`${C.red}${l}${C.r}`);
                else if (l.startsWith('@@')) console.log(`${C.bcyan}${l}${C.r}`);
                else console.log(`${C.d}${l}${C.r}`);
              });
            } catch {
              const stat = fs.statSync(abs);
              console.log(`${C.d}${arg}  ${stat.size} bytes  modified: ${stat.mtime.toISOString()}${C.r}`);
            }
          } catch (e) { console.log(`${C.red}✗ ${e.message}${C.r}`); }
          break;
        }

        case 'run':
          if (arg) { appendHistory(arg); await send(arg, cfg, history, state); }
          else console.log(`${C.red}Usage: /run <task>${C.r}`);
          break;

        default:
          console.log(`${C.red}Unknown command: /${cmd}${C.r}  Type ${C.cyan}/help${C.r}`);
      }

      rl.prompt();
      return;
    }

    // ── Paste detection ───────────────────────────────────────────────────────
    if (input.length > 2000) {
      const lines = input.split('\n').length;
      console.log(`${C.byellow}  ⚠ Large input: ~${lines} lines / ${input.length} chars${C.r}`);
    }

    // ── Detect ultrathink / deep keywords in input ────────────────────────────
    const kw = detectThinkingKeyword(input);
    if (kw && cfg.thinkingMode === 'adaptive') {
      console.log(`${C.d}  ◈ ${kw.mode === 'enabled' ? `Thinking enabled (${fmtTokens(kw.budget)} budget)` : 'Adaptive thinking'}${C.r}`);
    }

    // ── Regular message with auto-continue ────────────────────────────────────
    appendHistory(input);

    let currentInput = input;
    let continueCount = 0;
    const MAX_AUTO = 5;

    while (currentInput) {
      const result = await send(currentInput, cfg, history, state, { dream: cfg.dreamMode });
      if (!result) break;
      history.push({ role:'user', content:currentInput });
      history.push({ role:'assistant', content:result.reply });
      if (result.autoContinue && continueCount < MAX_AUTO) {
        continueCount++;
        console.log(`${C.byellow}↺ Continuing (${continueCount}/${MAX_AUTO}): ${result.autoContinue}${C.r}\n`);
        currentInput = result.autoContinue;
      } else { break; }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    saveConfig(cfg);
    console.log(`\n${C.d}Goodbye.${C.r}\n`);
    process.exit(0);
  });
}

main().catch(e => {
  console.error(`\n${C.red}Fatal error: ${e.message}${C.r}`);
  console.error(e.stack);
  process.exit(1);
});
