#!/usr/bin/env node
'use strict';

const DEFAULT_SERVER = process.env.OMNISHAPEAGENT_URL || 'http://127.0.0.1:3000';

function printHelp() {
  console.log([
    'OmniShapeAgent CLI',
    '',
    'This CLI is a thin client for the single shared OmniShapeAgent runtime.',
    `Default server: ${DEFAULT_SERVER}`,
    '',
    'Usage:',
    '  omnishapeagent status [--server URL]',
    '  omnishapeagent chat "message" [--server URL] [--model MODEL]',
    '  omnishapeagent telegram setup --token TOKEN [--server URL] [--mode polling|webhook] [--domain URL] [--chat-id ID]',
    '',
    'Examples:',
    '  omnishapeagent status',
    '  omnishapeagent chat "diagnose the system"',
    '  omnishapeagent telegram setup --token 123:abc --mode polling',
    '  omnishapeagent telegram setup --token 123:abc --mode webhook --domain https://agent.example.com',
  ].join('\n'));
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