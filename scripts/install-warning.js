#!/usr/bin/env node
'use strict';

console.warn([
  '',
  'WARNING: OmniShapeAgent can give the running agent broad access to your local system.',
  'It may execute terminal commands, read and write files, inspect network resources, and use enabled integrations.',
  'Install and run it only if you trust the package and want to grant that level of access.',
  'The first runtime launch will require confirmation unless you pass --yes.',
  '',
].join('\n'));