#!/usr/bin/env node
// Prints one table of verdicts per component, branch coverage per component and the mutation
// score where a Stryker report exists, all read from quality/reports/<component>/.
// Usage: node quality/summary.mjs [c1 c2 ...]   (default: every component with a report)
// When GITHUB_STEP_SUMMARY is set the same Markdown is appended to the job summary.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPORTS = join(import.meta.dirname, 'reports');
const NAMES = {
  c1: 'C1 Data — inventory integrity rules (SQL)',
  c2: 'C2 Logic — reservation request validation',
  c3: 'C3 Logic — queue status computation',
  c4: 'C4 Logic — payment webhook processing',
  c5: 'C5 Logic — gateway circuit breaker + retry',
  c6: 'C6 Presentation — PurchaseAction',
};

const asked = process.argv.slice(2);
const components = (asked.length ? asked : Object.keys(NAMES)).filter((c) => existsSync(join(REPORTS, c)));

const unescape = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function verdicts(component) {
  const file = join(REPORTS, component, 'junit.xml');
  if (!existsSync(file)) return null;
  const xml = readFileSync(file, 'utf8');
  const cases = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m; (m = re.exec(xml)); ) {
    const name = unescape(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '?');
    const body = m[3] ?? '';
    const status = /<(failure|error)\b/.test(body) ? 'FAIL' : /<skipped\b/.test(body) ? 'SKIP' : 'PASS';
    cases.push({ name, status });
  }
  return cases;
}

function branches(component) {
  const file = join(REPORTS, component, 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) return null;
  const { total } = JSON.parse(readFileSync(file, 'utf8'));
  return total.branches;
}

function mutation(component) {
  const file = join(REPORTS, component, 'mutation', 'mutation.json');
  if (!existsSync(file)) return null;
  const counts = {};
  for (const f of Object.values(JSON.parse(readFileSync(file, 'utf8')).files)) {
    for (const m of f.mutants) counts[m.status] = (counts[m.status] ?? 0) + 1;
  }
  const n = (s) => counts[s] ?? 0;
  const detected = n('Killed') + n('Timeout');
  const valid = detected + n('Survived') + n('NoCoverage');
  return { score: valid ? (100 * detected) / valid : 0, detected, valid, survived: n('Survived'), noCoverage: n('NoCoverage') };
}

function mutationC1() {
  const dir = join(REPORTS, 'c1', 'mutants');
  if (!existsSync(dir)) return null;
  const results = readdirSync(dir)
    .filter((f) => f.endsWith('.result'))
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  if (!results.length) return null;
  const killed = results.filter((r) => r.startsWith('KILLED')).length;
  return { score: (100 * killed) / results.length, detected: killed, valid: results.length, survived: results.length - killed, noCoverage: 0 };
}

const out = [];
const overview = [['Component', 'Tests', 'Passed', 'Failed', 'Branch coverage', 'Mutation score']];
let anyFailed = false;
for (const c of components) {
  const cases = verdicts(c) ?? [];
  const failed = cases.filter((t) => t.status === 'FAIL').length;
  anyFailed ||= failed > 0;
  const b = branches(c);
  const m = c === 'c1' ? mutationC1() : mutation(c);
  overview.push([
    NAMES[c] ?? c,
    String(cases.length),
    String(cases.filter((t) => t.status === 'PASS').length),
    String(failed),
    b ? `${b.pct}% (${b.covered}/${b.total})` : c === 'c1' ? 'n/a (rule/transition coverage, see quality/README.md)' : '—',
    m ? `${m.score.toFixed(2)}% (${m.detected}/${m.valid} detected, ${m.survived} survived, ${m.noCoverage} no coverage)` : '—',
  ]);
  out.push(`#### ${NAMES[c] ?? c}`, '', '| Verdict | Test |', '| --- | --- |');
  for (const t of cases) out.push(`| ${t.status === 'PASS' ? '✅ PASS' : t.status === 'FAIL' ? '❌ FAIL' : '⏭ SKIP'} | ${t.name.replace(/\|/g, '\\|')} |`);
  if (!cases.length) out.push('| — | no JUnit report found |');
  out.push('');
}

const table = (rows) => [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)];
const markdown = ['### Component-level verification (Quality P1)', '', ...table(overview), '', ...out].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
process.exitCode = anyFailed ? 1 : 0;
