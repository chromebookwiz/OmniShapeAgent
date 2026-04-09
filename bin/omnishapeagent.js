#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_HOST = process.env.OMNISHAPEAGENT_HOST || '0.0.0.0';
const DEFAULT_PORT = String(process.env.OMNISHAPEAGENT_PORT || process.env.PORT || '3000');
const DEFAULT_SERVER = process.env.OMNISHAPEAGENT_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
const CONSENT_FILE = path.join(PROJECT_ROOT, 'data', '.system-access-consent');
const RUNTIME_DIRS = [
  'data',
  'saved_chats',
  'screenshots',
  path.join('screenshots', 'generated'),
  'weights',
  'workspace',
];

function printHelp() {
  console.log([
    'OmniShapeAgent CLI',
    '',
    'This CLI is a thin client for the single shared OmniShapeAgent runtime.',
    `Default server: ${DEFAULT_SERVER}`,
    '',
    'Usage:',
    '  omnishapeagent serve [--port PORT] [--host HOST] [--dev] [--skip-build] [--rebuild] [--yes]',
    '  omnishapeagent status [--server URL]',
    '  omnishapeagent chat "message" [--server URL] [--model MODEL]',
    '  omnishapeagent telegram setup --token TOKEN [--server URL] [--mode polling|webhook] [--domain URL] [--chat-id ID]',
    '',
    'Examples:',
    '  omnishapeagent serve --yes',
    '  omnishapeagent serve --port 4123',
    '  npx omnishapeagent serve --port 3000 --yes',
    '  omnishapeagent status',
    '  omnishapeagent chat "diagnose the system"',
    '  omnishapeagent telegram setup --token 123:abc --mode polling',
    '  omnishapeagent telegram setup --token 123:abc --mode webhook --domain https://agent.example.com',
  ].join('\n'));
}

function warningBanner() {
  return [
    'WARNING: OmniShapeAgent can execute local tools with broad access to your system.',
    'It may read and write files, run terminal commands, inspect network resources, and operate connected integrations.',
    'Install or run it only if you trust the package and want to grant that level of access.',
    'Are you sure you want to proceed?',
  ].join('\n');
}

function recordConsent() {
  fs.mkdirSync(path.dirname(CONSENT_FILE), { recursive: true });
  fs.writeFileSync(CONSENT_FILE, `accepted ${new Date().toISOString()}\n`, 'utf8');
}

function hasRecordedConsent() {
  return fs.existsSync(CONSENT_FILE);
}

async function promptForConsent(flags) {
  if (flags.yes || flags.force || process.env.OMNISHAPEAGENT_YES === 'true') {
    recordConsent();
    return;
  }
  if (hasRecordedConsent()) {
    return;
  }
  console.warn(`\n${warningBanner()}\n`);
  let response = '';
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      response = (await rl.question('Type yes to continue: ')).trim().toLowerCase();
    } finally {
      rl.close();
    }
  } else {
    response = fs.readFileSync(0, 'utf8').trim().toLowerCase();
    if (!response) {
      console.error('Refusing to continue without explicit confirmation in a non-interactive session. Re-run with --yes or pipe "yes" if you intend to proceed.');
      process.exit(1);
    }
  }
  if (response !== 'yes' && response !== 'y') {
    console.error('Aborted. OmniShapeAgent was not started.');
    process.exit(1);
  }
  recordConsent();
}

function ensureRuntimeDirectories() {
  for (const relativeDir of RUNTIME_DIRS) {
    fs.mkdirSync(path.join(PROJECT_ROOT, relativeDir), { recursive: true });
  }
}

function resolveNextBin() {
  return require.resolve('next/dist/bin/next', { paths: [PROJECT_ROOT] });
}

function runNodeCommand(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env,
  });
}

function hasProductionBuild() {
  return fs.existsSync(path.join(PROJECT_ROOT, '.next', 'BUILD_ID'));
}

function hasLocalBuildToolchain() {
  try {
    require.resolve('typescript', { paths: [PROJECT_ROOT] });
    require.resolve('@tailwindcss/postcss', { paths: [PROJECT_ROOT] });
    return true;
  } catch {
    return false;
  }
}

async function serveRuntime(flags) {
  ensureRuntimeDirectories();
  await promptForConsent(flags);

  const host = typeof flags.host === 'string' ? flags.host : DEFAULT_HOST;
  const port = String(flags.port || DEFAULT_PORT);
  const devMode = Boolean(flags.dev);
  const skipBuild = Boolean(flags['skip-build']);
  const rebuild = Boolean(flags.rebuild);
  const nextBin = resolveNextBin();
  const env = {
    ...process.env,
    HOSTNAME: host,
    PORT: port,
    OMNISHAPEAGENT_HOST: host,
    OMNISHAPEAGENT_PORT: port,
    OMNISHAPEAGENT_URL: process.env.OMNISHAPEAGENT_URL || `http://127.0.0.1:${port}`,
  };

  if (devMode) {
    console.log(`Starting OmniShapeAgent in dev mode on http://127.0.0.1:${port} (host ${host})`);
    const result = runNodeCommand([nextBin, 'dev', '-H', host, '-p', port], env);
    process.exit(result.status ?? 0);
  }

  if (rebuild || (!skipBuild && !hasProductionBuild())) {
    if (!hasLocalBuildToolchain()) {
      console.error([
        'This OmniShapeAgent install does not include the build toolchain needed to regenerate the Next.js app.',
        'The published npm package is expected to ship with a ready-to-run production build.',
        'Reinstall the package, or run from a source checkout with npm install and npm run build.',
      ].join('\n'));
      process.exit(1);
    }
    console.log(rebuild ? 'Rebuilding OmniShapeAgent production bundle...' : 'No production build found. Building OmniShapeAgent...');
    const buildResult = runNodeCommand([nextBin, 'build'], env);
    if (buildResult.status !== 0) {
      process.exit(buildResult.status ?? 1);
    }
  }

  console.log(`Starting OmniShapeAgent on http://127.0.0.1:${port} (host ${host})`);
  const startResult = runNodeCommand([nextBin, 'start', '-H', host, '-p', port], env);
  process.exit(startResult.status ?? 0);
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index++;
  }
  return { positionals, flags };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error || data?.summary || data?.raw || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const server = String(flags.server || DEFAULT_SERVER).replace(/\/$/, '');
  const command = positionals[0] || 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'serve' || command === 'start') {
    await serveRuntime(flags);
    return;
  }

  if (command === 'status') {
    const data = await requestJson(`${server}/api/telegram/setup`, { method: 'GET' });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === 'chat') {
    const message = positionals.slice(1).join(' ').trim();
    if (!message) throw new Error('Chat message required.');
    const data = await requestJson(`${server}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: [],
        stream: false,
        model: typeof flags.model === 'string' ? flags.model : undefined,
      }),
    });
    console.log(data.reply || '');
    return;
  }

  if (command === 'telegram' && positionals[1] === 'setup') {
    const token = typeof flags.token === 'string' ? flags.token : '';
    if (!token) throw new Error('Telegram token required. Pass --token BOT_TOKEN.');
    const data = await requestJson(`${server}/api/telegram/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        mode: flags.mode === 'webhook' ? 'webhook' : 'polling',
        domain: typeof flags.domain === 'string' ? flags.domain : undefined,
        chatId: typeof flags['chat-id'] === 'string' ? flags['chat-id'] : undefined,
      }),
    });
    console.log(data.summary || JSON.stringify(data, null, 2));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});