import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
export const BACKUP_PREFIX = 'settings.json.backup-cc-usage-';
export const FETCH_BIN = 'cc-usage-fetch';
export const WRAP_BIN = 'cc-usage-bar-wrap';

export interface StatusLineConfig {
  type?: string;
  command?: string;
  refreshInterval?: number;
  _ccUsageInstalled?: boolean;
  _ccUsageOriginal?: string;
  [k: string]: unknown;
}

export interface ClaudeSettings {
  statusLine?: StatusLineConfig;
  [k: string]: unknown;
}

export class SettingsError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
  }
}

export function claudeDirExists(): boolean {
  return fs.existsSync(CLAUDE_DIR);
}

export function readSettings(): ClaudeSettings {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch {
    throw new SettingsError(
      `Cannot read ${SETTINGS_PATH}`,
      'check file permissions'
    );
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    throw new SettingsError(
      'Existing settings.json is not valid JSON',
      'fix the file manually before running install'
    );
  }
}

export function writeSettings(s: ClaudeSettings): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n');
}

export function backupSettings(): string | null {
  if (!fs.existsSync(SETTINGS_PATH)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(CLAUDE_DIR, `${BACKUP_PREFIX}${ts}`);
  fs.copyFileSync(SETTINGS_PATH, backupPath);
  return backupPath;
}

export function findBackups(): string[] {
  if (!fs.existsSync(CLAUDE_DIR)) return [];
  return fs
    .readdirSync(CLAUDE_DIR)
    .filter((f) => f.startsWith(BACKUP_PREFIX))
    .map((f) => path.join(CLAUDE_DIR, f))
    .sort();
}

export function findLatestBackup(): string | null {
  const all = findBackups();
  return all.length ? all[all.length - 1] : null;
}

export function isInstalled(s: ClaudeSettings): boolean {
  return !!s.statusLine?._ccUsageInstalled;
}

function unwrapPrior(existing: StatusLineConfig | undefined): StatusLineConfig | undefined {
  if (!existing?._ccUsageInstalled) return existing;
  if (existing._ccUsageOriginal !== undefined) {
    const restored: StatusLineConfig = { ...existing, command: existing._ccUsageOriginal };
    delete restored._ccUsageInstalled;
    delete restored._ccUsageOriginal;
    return restored;
  }
  return undefined;
}

export interface InstallOptions {
  format?: string;   // preset name
  barWidth?: number; // 1..50
  barSpec?: string;  // JSON bar spec
}

function shellQuotePosix(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// cmd.exe / Node CommandLineToArgvW: double-quotes group; embed " as \".
// Single quotes are NOT special on Windows — using POSIX quoting there silently
// truncates prefixes that contain spaces.
function shellQuoteWindows(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

export function shellQuoteForPlatform(s: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? shellQuoteWindows(s) : shellQuotePosix(s);
}

function buildFetchFlags(opts: InstallOptions, platform: NodeJS.Platform): string {
  const parts: string[] = [];
  if (opts.format) parts.push(`--format=${opts.format}`);
  if (typeof opts.barWidth === 'number') parts.push(`--bar-width=${opts.barWidth}`);
  if (opts.barSpec) parts.push(`--bar-spec=${shellQuoteForPlatform(opts.barSpec, platform)}`);
  return parts.join(' ');
}

function buildBareFetchCommand(opts: InstallOptions, platform: NodeJS.Platform): string {
  const flags = buildFetchFlags(opts, platform);
  return flags ? `${FETCH_BIN} ${flags}` : FETCH_BIN;
}

// With an existing prefix command, route through cc-usage-bar-wrap so it can:
// tee stdin to both prefix and cc-usage-fetch (preserving Claude Code's
// rate_limits → 0 API calls), and pick single-line vs wrap based on real
// terminal width. The wrapper handles the platform-specific shell internally.
function buildWrapCommand(prefix: string, opts: InstallOptions, platform: NodeJS.Platform): string {
  const flags = buildFetchFlags(opts, platform);
  const head = `${WRAP_BIN} --prefix=${shellQuoteForPlatform(prefix, platform)}`;
  return flags ? `${head} ${flags}` : head;
}

// Resolve the user's *true* prefix command, recovering from any prior
// cc-usage installation (whether it carries the `_ccUsageInstalled` marker
// or not).  Without this, calling `install` on top of a manual/AI-written
// install nests cc-usage-bar-wrap inside its own prefix → doubled bars and
// duplicated work each refresh.
function resolveBasePrefix(sl: StatusLineConfig | undefined): StatusLineConfig | undefined {
  if (!sl) return undefined;
  if (sl._ccUsageInstalled) return unwrapPrior(sl);
  if (sl.command && (sl.command.includes(FETCH_BIN) || sl.command.includes(WRAP_BIN))) {
    return applyUninstallSurgical({ statusLine: sl }).statusLine;
  }
  return sl;
}

export function applyInstall(
  s: ClaudeSettings,
  opts: InstallOptions = {},
  platform: NodeJS.Platform = process.platform
): ClaudeSettings {
  const next: ClaudeSettings = { ...s };
  const baseExisting = resolveBasePrefix(next.statusLine);

  if (!baseExisting || !baseExisting.command) {
    next.statusLine = {
      ...(baseExisting ?? {}),
      type: baseExisting?.type ?? 'command',
      command: buildBareFetchCommand(opts, platform),
      refreshInterval: baseExisting?.refreshInterval ?? 30,
      _ccUsageInstalled: true,
    };
    return next;
  }

  const original = baseExisting.command;
  next.statusLine = {
    ...baseExisting,
    command: buildWrapCommand(original, opts, platform),
    refreshInterval: baseExisting.refreshInterval ?? 30,
    _ccUsageInstalled: true,
    _ccUsageOriginal: original,
  };
  return next;
}

function restoreCommand(s: ClaudeSettings, inner: string): ClaudeSettings {
  const next: ClaudeSettings = { ...s };
  const sl: StatusLineConfig = { ...s.statusLine, command: inner };
  delete sl._ccUsageInstalled;
  delete sl._ccUsageOriginal;
  next.statusLine = sl;
  return next;
}

export function applyUninstallSurgical(s: ClaudeSettings): ClaudeSettings {
  if (!s.statusLine?.command) return s;
  const cmd = s.statusLine.command;
  if (!cmd.includes(FETCH_BIN) && !cmd.includes(WRAP_BIN)) return s;

  // Current wrapped form (v0.4+ POSIX): cc-usage-bar-wrap --prefix='<original>' [flags]
  const wrapFormPosix = cmd.match(/^cc-usage-bar-wrap --prefix='((?:[^']|'\\'')*)'.*$/s);
  if (wrapFormPosix) return restoreCommand(s, wrapFormPosix[1].replace(/'\\''/g, "'"));

  // Current wrapped form (v0.4+ Windows): cc-usage-bar-wrap --prefix="<original>" [flags]
  // Only " is escaped (as \"); raw backslashes (Windows paths) pass through.
  const wrapFormWin = cmd.match(/^cc-usage-bar-wrap --prefix="((?:\\.|[^"])*)".*$/s);
  if (wrapFormWin) return restoreCommand(s, wrapFormWin[1].replace(/\\"/g, '"'));

  // v0.2-0.3 form: sh -c 'printf "%s " "$(<original>)"; cc-usage-fetch[ args]'
  const printfDollarForm = cmd.match(/^sh -c 'printf "%s " "\$\((.*)\)"; cc-usage-fetch.*'$/s);
  if (printfDollarForm) return restoreCommand(s, printfDollarForm[1].replace(/'\\''/g, "'"));

  // v0.1 form: sh -c '<original>; (echo -n|printf) " "; cc-usage-fetch[ args]'
  const echoForm = cmd.match(/^sh -c '(.*); (?:echo -n|printf) " "; cc-usage-fetch[^']*'$/s);
  if (echoForm) return restoreCommand(s, echoForm[1].replace(/'\\''/g, "'"));

  // Standalone form (no prefix to restore): just drop the statusLine.
  const trimmed = cmd.trim();
  if (
    trimmed === FETCH_BIN ||
    trimmed.startsWith(FETCH_BIN + ' ') ||
    trimmed === WRAP_BIN ||
    trimmed.startsWith(WRAP_BIN + ' ')
  ) {
    const next: ClaudeSettings = { ...s };
    delete next.statusLine;
    return next;
  }

  return s;
}

export function restoreFromBackup(backupPath: string): void {
  const raw = fs.readFileSync(backupPath, 'utf8');
  const parsed = JSON.parse(raw) as ClaudeSettings;
  writeSettings(parsed);
}

export function deleteBackups(): number {
  const backups = findBackups();
  let count = 0;
  for (const b of backups) {
    try {
      fs.unlinkSync(b);
      count++;
    } catch {
      // ignore
    }
  }
  return count;
}
