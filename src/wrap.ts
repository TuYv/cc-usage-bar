import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArg } from './fetch';

export type Layout = 'auto' | 'single' | 'multi';

interface WrapArgs {
  prefix: string;
  layout: Layout;
  fetchArgs: string[];
}

const FETCH_BIN = path.resolve(__dirname, '..', '..', 'bin', 'cc-usage-fetch.js');
const RESERVED = new Set(['--prefix', '--layout', '--help', '-h']);

function isLayout(s: string): s is Layout {
  return s === 'auto' || s === 'single' || s === 'multi';
}

function parseArgs(argv: string[]): WrapArgs {
  const prefix = parseArg(argv, 'prefix') ?? process.env.CC_STATUSLINE_PREFIX ?? '';
  const envLayout = process.env.CC_STATUSLINE_LAYOUT ?? '';
  let layout: Layout = isLayout(envLayout) ? envLayout : 'auto';
  const layoutArg = parseArg(argv, 'layout');
  if (layoutArg && isLayout(layoutArg)) layout = layoutArg;

  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Forward everything except our own flags (and their values when separated).
  const fetchArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--prefix=') || a.startsWith('--layout=')) continue;
    if (RESERVED.has(a)) {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) i++; // skip its value
      continue;
    }
    fetchArgs.push(a);
  }
  return { prefix, layout, fetchArgs };
}

function readStdinSync(): string {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function spawnCapture(cmd: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v: string) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      return finish('');
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(out);
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.on('close', () => { clearTimeout(timer); finish(out); });
    child.on('error', () => { clearTimeout(timer); finish(''); });
    try {
      if (input) child.stdin?.write(input);
      child.stdin?.end();
    } catch {
      clearTimeout(timer);
      finish('');
    }
  });
}

function runShell(cmd: string, input: string): Promise<string> {
  if (!cmd) return Promise.resolve('');
  const isWin = process.platform === 'win32';
  return spawnCapture(isWin ? 'cmd.exe' : 'sh', isWin ? ['/c', cmd] : ['-c', cmd], input, 5000);
}

function runFetch(fetchArgs: string[], input: string): Promise<string> {
  return spawnCapture(process.execPath, [FETCH_BIN, ...fetchArgs], input, 8000);
}

export function detectColumns(): number {
  if (process.platform !== 'win32') {
    const r = spawnSync('sh', ['-c', 'stty size </dev/tty 2>/dev/null'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    });
    const m = (r.stdout ?? '').trim().match(/^(\d+)\s+(\d+)$/);
    if (m) return parseInt(m[2], 10);
  } else {
    const r = spawnSync('cmd.exe', ['/c', 'mode', 'con'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
    });
    const m = (r.stdout ?? '').match(/Columns:\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }
  const env = process.env.COLUMNS;
  if (env && /^\d+$/.test(env)) return parseInt(env, 10);
  return 0;
}

const ANSI_CSI_RE = /\x1b\[[0-9;]*m/g;

// East Asian Wide / Fullwidth ranges plus the BMP + supplementary emoji blocks
// most likely to appear in a Claude Code statusline (CJK ideographs, Hangul,
// kana, fullwidth forms, common emoji). Matches one grapheme that should be
// counted as 2 terminal cells; everything else counts as 1.
const WIDE_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1F300}-\u{1FAFF}]|[\u{20000}-\u{3FFFD}]/u;

const ASCII_PRINTABLE_RE = /^[\x20-\x7E]*$/;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function visibleLength(s: string): number {
  const stripped = s.replace(ANSI_CSI_RE, '');
  // Most ticks are pure ASCII (digits, ANSI-stripped brackets, percent text);
  // skip grapheme segmentation when it can't change the answer.
  if (ASCII_PRINTABLE_RE.test(stripped)) return stripped.length;
  let w = 0;
  for (const { segment } of segmenter.segment(stripped)) {
    w += WIDE_RE.test(segment) ? 2 : 1;
  }
  return w;
}

export function decideWrap(layout: Layout, prefix: string, bar: string, cols: number): boolean {
  if (layout === 'single') return false;
  if (layout === 'multi') return true;
  if (!prefix || !bar) return false;
  if (cols <= 0) return true;
  return visibleLength(prefix) + 1 + visibleLength(bar) > cols;
}

export function compose(prefix: string, bar: string, wrap: boolean): string {
  if (!prefix && !bar) return '';
  if (!prefix) return bar;
  if (!bar) return prefix;
  return prefix + (wrap ? '\n' : ' ') + bar;
}

function printHelp(): void {
  process.stdout.write(`cc-usage-bar-wrap — adaptive statusline composer.

Reads stdin (Claude Code statusline JSON), runs an optional prefix command and
cc-usage-fetch with the same stdin, then composes one or two lines based on the
real terminal width.

Usage: cc-usage-bar-wrap [options] [cc-usage-fetch args...]

Options:
  --prefix=<command>           Shell command rendering the prefix (default: $CC_STATUSLINE_PREFIX, empty)
  --layout=<auto|single|multi> auto = single line if it fits, else wrap (default: auto, env: CC_STATUSLINE_LAYOUT)
  --help                       Show this message

Any unrecognised argument is forwarded to cc-usage-fetch:
  cc-usage-bar-wrap --prefix='sh ~/.claude/prefix.sh' --format=bar-time --bar-width=10
`);
}

export async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const input = readStdinSync();

  const [prefixOut, barOut] = await Promise.all([runShell(opts.prefix, input), runFetch(opts.fetchArgs, input)]);
  const prefix = prefixOut.replace(/\r?\n$/, '');
  const bar = barOut.replace(/\r?\n$/, '');

  const cols = opts.layout === 'auto' ? detectColumns() : 0;
  const wrap = decideWrap(opts.layout, prefix, bar, cols);
  const out = compose(prefix, bar, wrap);
  if (out) process.stdout.write(out);
}
