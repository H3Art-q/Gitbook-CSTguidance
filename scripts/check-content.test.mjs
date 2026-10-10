import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checkerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-content.mjs');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'content-check-'));
  mkdirSync(path.join(root, 'scripts'));
  cpSync(checkerPath, path.join(root, 'scripts', 'check-content.mjs'));
  writeFileSync(path.join(root, 'SUMMARY.md'), '# Table of contents\n\n* [Home](README.md)\n');
  writeFileSync(path.join(root, 'README.md'), '# Home\n\n![ ](legacy.png)\n');
  writeFileSync(path.join(root, 'legacy.png'), Buffer.from('not-a-real-image'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'content-check@example.invalid']);
  git(root, ['config', 'user.name', 'Content Check Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  return root;
}

function check(root, ...args) {
  return spawnSync(process.execPath, ['scripts/check-content.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('reports baseline problems without failing default mode', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 new, 1 legacy/);
  assert.match(result.stdout, /image-alt-missing/);
});

test('fails for problems in a newly added page', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, 'study'));
  writeFileSync(path.join(root, 'study', 'new.md'), '# New\n\n### Skipped level\n\n[Broken](missing.md)\n\n![](missing.png)\n');
  const result = check(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /metadata-description-missing/);
  assert.match(result.stdout, /heading-h3-without-h2/);
  assert.match(result.stdout, /link-missing/);
  assert.match(result.stdout, /image-missing/);
  assert.match(result.stdout, /image-alt-missing/);
});

test('requires metadata after a page migration but preserves renamed legacy findings', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  renameSync(path.join(root, 'README.md'), path.join(root, 'moved.md'));
  writeFileSync(path.join(root, 'SUMMARY.md'), '# Table of contents\n\n* [Home](moved.md)\n');
  git(root, ['add', '-A']);
  const result = check(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /1 new, 1 legacy/);
  assert.match(result.stdout, /metadata-description-missing/);
});

test('fails when SUMMARY points to a missing page', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(path.join(root, 'SUMMARY.md'), '# Table of contents\n\n* [Missing](missing.md)\n');
  const result = check(root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /summary-missing/);
});

test('does not require page metadata for repository governance documents', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(path.join(root, 'CONTRIBUTING.md'), '# Contributing\n\nRepository workflow.\n');
  mkdirSync(path.join(root, '.github'));
  writeFileSync(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## Checklist\n');
  mkdirSync(path.join(root, '_book'));
  writeFileSync(path.join(root, '_book', 'generated.md'), 'Generated output without a title.\n');
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /metadata-description-missing/);
});

test('ignores Markdown examples in code and recognizes a setext H1', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(path.join(root, 'README.md'), `Home
====

\`[inline example](missing.md)\`

<!-- ![](also-missing.png) -->

\`\`\`markdown
[fenced example](missing.md)
\`\`\`
`);
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 current issue/);
});
