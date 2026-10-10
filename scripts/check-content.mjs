#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const DEFAULT_MAX_IMAGE_BYTES = 1024 * 1024;
const TOOLING_DIRECTORIES = new Set(['.git', '_book', 'node_modules', 'scripts']);

function usage() {
  console.log(`Usage: node scripts/check-content.mjs [options]

Options:
  --base <git-ref>          Compare against this ref (default: merge-base with
                            CONTENT_CHECK_BASE, origin/main, or main)
  --max-image-bytes <n>     Large-image threshold (default: 1048576)
  --strict                  Fail for every current issue, including legacy ones
  --json                    Print a machine-readable JSON report
  --help                    Show this help

Without --strict, legacy issues are reported but only issues absent from the
Git baseline make the command fail.`);
}

function parseArguments(argv) {
  const options = {
    base: process.env.CONTENT_CHECK_BASE || null,
    json: false,
    maxImageBytes: Number(process.env.CONTENT_CHECK_MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES),
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base') options.base = argv[++index];
    else if (argument === '--max-image-bytes') options.maxImageBytes = Number(argv[++index]);
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.base && argv.includes('--base')) throw new Error('--base requires a Git ref');
  if (!Number.isSafeInteger(options.maxImageBytes) || options.maxImageBytes < 1) {
    throw new Error('--max-image-bytes must be a positive integer');
  }
  return options;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeRepositoryPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function walkFiles(rootDirectory) {
  const files = [];
  function visit(relativeDirectory) {
    const absoluteDirectory = path.join(rootDirectory, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && TOOLING_DIRECTORIES.has(entry.name)) continue;
      const relativePath = normalizeRepositoryPath(path.join(relativeDirectory, entry.name));
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }
  visit('');
  return files;
}

function makeWorkingTreeSnapshot(rootDirectory) {
  const paths = walkFiles(rootDirectory);
  const pathSet = new Set(paths);
  return {
    label: 'working tree',
    paths,
    has(filePath) {
      return pathSet.has(filePath);
    },
    read(filePath) {
      return readFileSync(path.join(rootDirectory, ...filePath.split('/')));
    },
    size(filePath) {
      return statSync(path.join(rootDirectory, ...filePath.split('/'))).size;
    },
  };
}

function makeGitSnapshot(rootDirectory, ref) {
  const output = git(['ls-tree', '-r', '-z', '--name-only', ref], { cwd: rootDirectory });
  const paths = output.split('\0').filter(Boolean).map(normalizeRepositoryPath);
  const pathSet = new Set(paths);
  return {
    label: ref,
    paths,
    has(filePath) {
      return pathSet.has(filePath);
    },
    read(filePath) {
      return git(['show', `${ref}:${filePath}`], { cwd: rootDirectory, encoding: 'buffer' });
    },
    size(filePath) {
      return Number(git(['cat-file', '-s', `${ref}:${filePath}`], { cwd: rootDirectory }).trim());
    },
  };
}

function resolveBase(rootDirectory, requestedRef) {
  let insideRepository = false;
  try {
    insideRepository = git(['rev-parse', '--is-inside-work-tree'], { cwd: rootDirectory }).trim() === 'true';
  } catch {
    return null;
  }
  if (!insideRepository) return null;

  const candidates = requestedRef ? [requestedRef] : ['origin/main', 'main'];
  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', `${candidate}^{commit}`], { cwd: rootDirectory });
      return git(['merge-base', 'HEAD', candidate], { cwd: rootDirectory }).trim();
    } catch {
      // Try the next conventional base.
    }
  }
  if (requestedRef) throw new Error(`Cannot resolve Git base: ${requestedRef}`);
  return null;
}

function requiresPageMetadata(filePath) {
  return filePath === 'README.md'
    || ['intro/', 'navigation/', 'study/', 'survival/', 'tail/']
      .some((prefix) => filePath.startsWith(prefix));
}

function changedPages(rootDirectory, base, currentSummaryTargets, baselineSummaryTargets) {
  const pages = new Set([...currentSummaryTargets].filter((target) => !baselineSummaryTargets.has(target)));
  const renameMap = new Map();
  if (!base) return { pages, renameMap };

  const output = git(['diff', '--name-status', '-M', '--find-copies', base, '--'], { cwd: rootDirectory });
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const [status, firstPath, secondPath] = line.split('\t');
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = normalizeRepositoryPath(firstPath);
      const newPath = normalizeRepositoryPath(secondPath);
      renameMap.set(newPath, oldPath);
      if (requiresPageMetadata(newPath)) pages.add(newPath);
    } else if (kind === 'A' && firstPath) {
      const newPath = normalizeRepositoryPath(firstPath);
      if (requiresPageMetadata(newPath)) pages.add(newPath);
    }
  }
  pages.delete('SUMMARY.md');
  return { pages, renameMap };
}

function isContentMarkdown(filePath) {
  return filePath.endsWith('.md')
    && filePath !== 'SUMMARY.md'
    && !filePath.startsWith('.github/')
    && !filePath.startsWith('scripts/');
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function maskNonContent(text) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = null;
  let inFrontMatter = lines[0]?.trim() === '---';

  const withoutBlocks = lines.map((line, index) => {
    if (inFrontMatter) {
      if (index > 0 && line.trim() === '---') inFrontMatter = false;
      return '';
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      return '';
    }
    return inFence ? '' : line;
  }).join('\n');
  return withoutBlocks
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(`+)([\s\S]*?)\1/g, (code) => code.replace(/[^\n]/g, ' '));
}

function extractSummaryTargets(snapshot) {
  if (!snapshot.has('SUMMARY.md')) return new Set();
  const text = snapshot.read('SUMMARY.md').toString('utf8');
  const targets = new Set();
  const linkPattern = /\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const resolved = resolveLocalTarget('SUMMARY.md', match[1]);
    if (resolved?.path) targets.add(resolved.path);
  }
  return targets;
}

function resolveLocalTarget(sourcePath, rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.replaceAll('&amp;', '&');
  if (!target || target.startsWith('#') || target.startsWith('//')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;

  const pathPart = target.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return { invalidEncoding: true, path: pathPart, rawTarget };
  }
  decoded = decoded.replaceAll('\\', '/');
  const joined = decoded.startsWith('/')
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded));
  if (joined === '..' || joined.startsWith('../')) return { outsideRoot: true, path: joined, rawTarget };
  return { path: joined.replace(/^\.\//, ''), rawTarget };
}

function targetExists(snapshot, targetPath) {
  const candidates = [targetPath];
  if (targetPath.endsWith('/')) {
    candidates.push(`${targetPath}README.md`, `${targetPath}index.md`);
  } else if (!path.posix.extname(targetPath)) {
    candidates.push(`${targetPath}.md`, `${targetPath}/README.md`, `${targetPath}/index.md`);
  }
  return candidates.some((candidate) => snapshot.has(candidate));
}

function hasDescription(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end < 0) return false;
  const frontMatter = lines.slice(1, end + 1);
  const index = frontMatter.findIndex((line) => /^description\s*:/.test(line));
  if (index < 0) return false;
  const value = frontMatter[index].replace(/^description\s*:\s*/, '').trim();
  if (!value) return false;
  if (/^[>|][+-]?$/.test(value)) {
    return frontMatter.slice(index + 1).some((line) => /^\s+\S/.test(line));
  }
  return !/^(['"])\1$/.test(value) && value !== 'null' && value !== '~';
}

function makeIssue(rule, file, line, message, identity, details = {}) {
  return { rule, file, line, message, identity: identity ?? message, ...details };
}

function inspectTarget(snapshot, sourceFile, rawTarget, kind, line, issues) {
  const target = resolveLocalTarget(sourceFile, rawTarget);
  if (!target) return;
  const identity = `${kind}:${rawTarget}`;
  if (target.invalidEncoding) {
    issues.push(makeIssue('path-invalid-encoding', sourceFile, line,
      `${kind} path has invalid URL encoding: ${rawTarget}`, identity));
  } else if (target.outsideRoot) {
    issues.push(makeIssue('path-outside-root', sourceFile, line,
      `${kind} path escapes the repository: ${rawTarget}`, identity));
  } else if (!targetExists(snapshot, target.path)) {
    issues.push(makeIssue(`${kind}-missing`, sourceFile, line,
      `${kind} target does not exist: ${rawTarget}`, identity, { target: target.path }));
  }
  return target;
}

function inspectMarkdown(snapshot, filePath, text, maxImageBytes, largeImages, issues) {
  const masked = maskNonContent(text);
  const headings = [];
  for (const match of masked.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    headings.push({ level: match[1].length, text: match[2], line: lineNumberAt(masked, match.index) });
  }
  for (const match of masked.matchAll(/^([^\n]+)\n(=+|-+)\s*$/gm)) {
    headings.push({
      level: match[2][0] === '=' ? 1 : 2,
      text: match[1].trim(),
      line: lineNumberAt(masked, match.index),
    });
  }
  headings.sort((left, right) => left.line - right.line);

  const h1Headings = headings.filter((heading) => heading.level === 1);
  if (h1Headings.length !== 1) {
    issues.push(makeIssue('heading-h1-count', filePath, h1Headings[0]?.line ?? 1,
      `page must contain exactly one H1; found ${h1Headings.length}`, 'h1-count'));
  }
  let seenH2 = false;
  for (const heading of headings) {
    if (heading.level === 2) seenH2 = true;
    if (heading.level === 1) seenH2 = false;
    if (heading.level === 3 && !seenH2) {
      issues.push(makeIssue('heading-h3-without-h2', filePath, heading.line,
        `H3 appears before an H2 in its H1 section: ${heading.text}`, `h3:${heading.text}`));
    }
  }

  const definitions = new Map();
  for (const match of masked.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
    definitions.set(match[1].trim().toLowerCase(), match[2]);
  }

  const inlinePattern = /(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/g;
  for (const match of masked.matchAll(inlinePattern)) {
    const isImage = match[1] === '!';
    const line = lineNumberAt(masked, match.index);
    const kind = isImage ? 'image' : 'link';
    const target = inspectTarget(snapshot, filePath, match[3], kind, line, issues);
    if (isImage) inspectImage(snapshot, filePath, line, match[2], match[3], target, maxImageBytes, largeImages, issues);
  }

  const referencePattern = /(!?)\[([^\]]*)\]\[([^\]]*)\]/g;
  for (const match of masked.matchAll(referencePattern)) {
    const label = (match[3] || match[2]).trim().toLowerCase();
    const line = lineNumberAt(masked, match.index);
    const rawTarget = definitions.get(label);
    if (!rawTarget) {
      issues.push(makeIssue('markdown-reference-missing', filePath, line,
        `reference definition does not exist: [${label}]`, `reference:${label}`));
      continue;
    }
    const isImage = match[1] === '!';
    const kind = isImage ? 'image' : 'link';
    const target = inspectTarget(snapshot, filePath, rawTarget, kind, line, issues);
    if (isImage) inspectImage(snapshot, filePath, line, match[2], rawTarget, target, maxImageBytes, largeImages, issues);
  }

  const htmlImagePattern = /<img\b([^>]*?)>/gi;
  for (const match of masked.matchAll(htmlImagePattern)) {
    const attributes = match[1];
    const source = attributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    if (!source) continue;
    const rawTarget = source[1] ?? source[2] ?? source[3];
    const alt = attributes.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const altText = alt ? (alt[1] ?? alt[2] ?? alt[3]) : '';
    const line = lineNumberAt(masked, match.index);
    const target = inspectTarget(snapshot, filePath, rawTarget, 'image', line, issues);
    inspectImage(snapshot, filePath, line, altText, rawTarget, target, maxImageBytes, largeImages, issues);
  }
}

function inspectImage(snapshot, filePath, line, altText, rawTarget, target, maxImageBytes, largeImages, issues) {
  if (!altText.trim()) {
    issues.push(makeIssue('image-alt-missing', filePath, line,
      `image has no alternative text: ${rawTarget}`, `alt:${rawTarget}`));
  }
  if (!target?.path || !snapshot.has(target.path) || !IMAGE_EXTENSIONS.has(path.posix.extname(target.path).toLowerCase())) return;
  const size = snapshot.size(target.path);
  if (size > maxImageBytes && !largeImages.has(target.path)) {
    largeImages.add(target.path);
    issues.push(makeIssue('image-too-large', filePath, line,
      `image is ${formatBytes(size)} (limit ${formatBytes(maxImageBytes)}): ${rawTarget}`,
      `large:${target.path}`, { bytes: size, target: target.path }));
  }
}

function inspectSnapshot(snapshot, options) {
  const issues = [];
  const summaryTargets = extractSummaryTargets(snapshot);
  if (!snapshot.has('SUMMARY.md')) {
    issues.push(makeIssue('summary-missing', 'SUMMARY.md', 1, 'SUMMARY.md does not exist', 'summary'));
  } else {
    const summaryText = snapshot.read('SUMMARY.md').toString('utf8');
    const linkPattern = /\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/g;
    for (const match of summaryText.matchAll(linkPattern)) {
      inspectTarget(snapshot, 'SUMMARY.md', match[1], 'summary', lineNumberAt(summaryText, match.index), issues);
    }
  }

  const largeImages = new Set();
  for (const filePath of snapshot.paths.filter(isContentMarkdown).sort()) {
    const text = snapshot.read(filePath).toString('utf8');
    inspectMarkdown(snapshot, filePath, text, options.maxImageBytes, largeImages, issues);
    if (options.metadataPages?.has(filePath) && !hasDescription(text)) {
      issues.push(makeIssue('metadata-description-missing', filePath, 1,
        'new or migrated page must have a non-empty front matter description', 'description'));
    }
  }
  return { issues, summaryTargets };
}

function issueKey(issue, renameMap = new Map()) {
  const comparableFile = renameMap.get(issue.file) ?? issue.file;
  return `${issue.rule}\0${comparableFile}\0${issue.identity}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function printHumanReport(report) {
  console.log(`Content check: ${report.currentIssues.length} current issue(s), ${report.newIssues.length} new, ${report.legacyIssues.length} legacy`);
  console.log(`Baseline: ${report.base ?? 'none (all issues are new)'} | large image limit: ${formatBytes(report.maxImageBytes)}`);
  for (const [label, issues] of [['NEW', report.newIssues], ['LEGACY', report.legacyIssues]]) {
    if (issues.length === 0) continue;
    console.log(`\n${label}`);
    for (const issue of issues) {
      console.log(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`);
    }
  }
  if (report.resolvedCount > 0) console.log(`\nResolved baseline issues: ${report.resolvedCount}`);
}

export function run(argv = process.argv.slice(2), rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const options = parseArguments(argv);
  const currentSnapshot = makeWorkingTreeSnapshot(rootDirectory);
  const base = resolveBase(rootDirectory, options.base);
  const baselineSnapshot = base ? makeGitSnapshot(rootDirectory, base) : null;
  const currentSummaryTargets = extractSummaryTargets(currentSnapshot);
  const baselineSummaryTargets = baselineSnapshot ? extractSummaryTargets(baselineSnapshot) : new Set();
  const { pages: metadataPages, renameMap } = changedPages(
    rootDirectory, base, currentSummaryTargets, baselineSummaryTargets,
  );
  if (baselineSnapshot) {
    for (const filePath of currentSnapshot.paths.filter(requiresPageMetadata)) {
      if (!baselineSnapshot.has(filePath) && !renameMap.has(filePath)) metadataPages.add(filePath);
    }
  } else {
    for (const filePath of currentSnapshot.paths.filter(requiresPageMetadata)) metadataPages.add(filePath);
  }

  const current = inspectSnapshot(currentSnapshot, { ...options, metadataPages });
  const baseline = baselineSnapshot
    ? inspectSnapshot(baselineSnapshot, { ...options, metadataPages: new Set() })
    : { issues: [] };
  const baselineKeys = new Set(baseline.issues.map((issue) => issueKey(issue)));
  const currentKeys = new Set(current.issues.map((issue) => issueKey(issue, renameMap)));
  const newIssues = current.issues.filter((issue) => !baselineKeys.has(issueKey(issue, renameMap)));
  const legacyIssues = current.issues.filter((issue) => baselineKeys.has(issueKey(issue, renameMap)));
  const resolvedCount = baseline.issues.filter((issue) => !currentKeys.has(issueKey(issue))).length;
  const report = {
    base,
    maxImageBytes: options.maxImageBytes,
    currentIssues: current.issues,
    newIssues,
    legacyIssues,
    resolvedCount,
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
  process.exitCode = options.strict ? Number(current.issues.length > 0) : Number(newIssues.length > 0);
  return report;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(`content check failed to run: ${error.message}`);
    process.exitCode = 2;
  }
}
