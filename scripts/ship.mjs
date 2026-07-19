/**
 * One-command release pipeline for `npm run ship`:
 *   1. Bumps the version in package.json (prompts patch/minor/major, Enter = patch)
 *   2. Runs `npm run release` (build + package + publish to GitHub Releases)
 *   3. Un-drafts the release electron-builder just created — electron-updater
 *      clients can't see draft releases, and this used to be a manual
 *      `gh release edit --draft=false` step after every ship.
 *   4. Prints the new version and a link to the live release.
 *
 * Needs the GitHub CLI authenticated (`gh auth login`) — its token is reused
 * for electron-builder's publish step too, so a separate GH_TOKEN isn't needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(projectRoot, 'package.json');

function findGh() {
  const candidates = [
    'gh',
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
  ];
  for (const candidate of candidates) {
    if (!spawnSync(candidate, ['--version'], { stdio: 'ignore' }).error) return candidate;
  }
  console.error('GitHub CLI (gh) not found on PATH or in the usual install locations.');
  process.exit(1);
}

function bumpVersion(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()); }));
}

async function resolveBumpKind() {
  const arg = process.argv[2];
  if (arg === 'patch' || arg === 'minor' || arg === 'major') return arg;
  const answer = await ask('Version bump - patch/minor/major? [patch]: ');
  return answer === 'minor' || answer === 'major' ? answer : 'patch';
}

const gh = findGh();

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const owner = pkg.build?.publish?.[0]?.owner;
const repo = pkg.build?.publish?.[0]?.repo;
if (!owner || !repo) {
  console.error('Could not resolve GitHub owner/repo from package.json build.publish[0].');
  process.exit(1);
}

const kind = await resolveBumpKind();
const newVersion = bumpVersion(pkg.version, kind);
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\nVersion bumped: ${newVersion} (${kind})`);

let ghToken;
try {
  ghToken = execFileSync(gh, ['auth', 'token'], { encoding: 'utf8' }).trim();
} catch {
  console.error('Could not get a token from `gh auth token` — run `gh auth login` first.');
  process.exit(1);
}

console.log('\nBuilding and publishing release (npm run release)...\n');
const releaseResult = spawnSync('npm', ['run', 'release'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: ghToken },
});
if (releaseResult.status !== 0) {
  console.error(`\nRelease build/publish failed. package.json is already at ${newVersion} — fix the issue and re-run "npm run ship ${kind}" once, or bump manually before retrying.`);
  process.exit(releaseResult.status ?? 1);
}

const tag = `v${newVersion}`;
console.log(`\nPublishing release ${tag} (un-drafting)...`);
const undraft = spawnSync(gh, ['release', 'edit', tag, '--repo', `${owner}/${repo}`, '--draft=false'], { stdio: 'inherit' });
if (undraft.status !== 0) {
  console.error(`\nBuild succeeded but could not auto-undraft ${tag}. Run manually:\n  gh release edit ${tag} --repo ${owner}/${repo} --draft=false`);
  process.exit(undraft.status ?? 1);
}

const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${tag}`;
console.log(`\nShipped v${newVersion} — live release (not draft): ${releaseUrl}\n`);
