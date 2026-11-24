// Token launch radar: the entrypoint the grader runs (Node 22, standard library only).
//
// What one run does, in order:
//   1. finds the sealed snapshot (a file or a directory holding snapshot.json);
//   2. scores it with the model in lib/model.ts and refuses a board the gate would refuse;
//   3. writes board.json (the ranked deliverable) and data.js (the dashboard's dataset);
//   4. copies this repository's dashboard/ and screenshots/ into the output, checking the
//      screenshot rules on the way (three to four images, each under the byte cap);
//   5. writes dossier.json last, with the vendored make.fun library, because the scorer
//      rebuilds it from the finished output and compares bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The scorer's caps, mirrored here so a bad output fails at write time, not at grading. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_RULES = { max: 4, max_bytes: 524_288 };
const DASHBOARD_RULES = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const here = fileURLToPath(new URL('.', import.meta.url));

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

/** Stop the run with a message a human can act on. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

// --- the snapshot ---------------------------------------------------------------

const inputArg = readArg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// --- the board ------------------------------------------------------------------

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

const out = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// --- the dashboard and the screenshots ------------------------------------------

/** Copy a directory's regular files, in name order, skipping dotfiles. Returns the names. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyDirectory(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDirectory(join(here, 'screenshots'), join(out, 'screenshots'));

if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_RULES.max_bytes) fail(`screenshots/${name} is ${bytes} bytes, over the ${SCREENSHOT_RULES.max_bytes} cap`);
}

// --- the dossier, written last on purpose ----------------------------------------

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_RULES, dashboard: DASHBOARD_RULES }),
);

// --- the run's own summary --------------------------------------------------------

const tiers = { ready: 0, building: 0, early: 0 };
for (const row of radar.rows) tiers[row.tier] += 1;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored ` +
    `(${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: readiness tiers: ${tiers.ready} ready, ${tiers.building} building, ${tiers.early} early; ` +
    `${radar.categories.length} categories calibrated from the snapshot's live-token protocols\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
