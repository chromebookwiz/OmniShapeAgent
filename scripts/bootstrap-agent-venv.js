#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const venvDir = path.join(root, '.agent_venv');
const pythonBin = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

if (fs.existsSync(pythonBin)) {
  console.log(`[postinstall] Python venv ready: ${pythonBin}`);
  process.exit(0);
}

const candidates = process.platform === 'win32'
  ? [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
      { command: 'python3', args: [] },
    ]
  : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

let lastError = 'No Python interpreter was found.';

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.args, '-m', 'venv', venvDir], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status === 0 && fs.existsSync(pythonBin)) {
    console.log(`[postinstall] Created Python venv at ${venvDir}`);
    process.exit(0);
  }

  if (result.error) {
    lastError = result.error.message;
  } else if (typeof result.status === 'number') {
    lastError = `${candidate.command} exited with status ${result.status}`;
  }
}

console.error(`[postinstall] Failed to create .agent_venv. ${lastError}`);
console.error('[postinstall] Install Python 3 with venv support, then rerun npm install.');
process.exit(1);