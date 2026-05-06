import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
export const BACKUP_PREFIX = 'settings.json.backup-cc-usage-';
export const FETCH_BIN = 'cc-usage-fetch';

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

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildFetchCommand(opts: InstallOptions): string {
  const parts = [FETCH_BIN];
  if (opts.format) parts.push(`--format=${opts.format}`);
  if (typeof opts.barWidth === 'number') parts.push(`--bar-width=${opts.barWidth}`);
  if (opts.barSpec) parts.push(`--bar-spec=${shellQuote(opts.barSpec)}`);
  return parts.join(' ');
}

export function applyInstall(s: ClaudeSettings, opts: InstallOptions = {}): ClaudeSettings {
  const next: ClaudeSettings = { ...s };
  const baseExisting = unwrapPrior(next.statusLine);
  const fetchCmd = buildFetchCommand(opts);

  if (!baseExisting || !baseExisting.command) {
    next.statusLine = {
      ...(baseExisting ?? {}),
      type: baseExisting?.type ?? 'command',
      command: fetchCmd,
      refreshInterval: baseExisting?.refreshInterval ?? 30,
      _ccUsageInstalled: true,
    };
    return next;
  }

  const original = baseExisting.command;
  const escaped = original.replace(/'/g, `'\\''`);
  // `$(...)` strips trailing newlines per POSIX, so the original command's
  // implicit `\n` doesn't push cc-usage onto a new visual line. Then printf
  // (not `echo -n` — broken under bash POSIX mode) adds a single space.
  const escapedFetchCmd = fetchCmd.replace(/'/g, `'\\''`);
  const wrapped = `sh -c 'printf "%s " "$(${escaped})"; ${escapedFetchCmd}'`;
  next.statusLine = {
    ...baseExisting,
    command: wrapped,
    refreshInterval: baseExisting.refreshInterval ?? 30,
    _ccUsageInstalled: true,
    _ccUsageOriginal: original,
  };
  return next;
}

export function applyUninstallSurgical(s: ClaudeSettings): ClaudeSettings {
  if (!s.statusLine?.command) return s;
  const cmd = s.statusLine.command;
  if (!cmd.includes(FETCH_BIN)) return s;

  // Match current wrapped form: sh -c 'printf "%s " "$(<original>)"; cc-usage-fetch[ args]'
  const currentWrapMatch = cmd.match(/^sh -c 'printf "%s " "\$\((.*)\)"; cc-usage-fetch.*'$/s);
  if (currentWrapMatch) {
    const inner = currentWrapMatch[1].replace(/'\\''/g, "'");
    const next: ClaudeSettings = { ...s };
    const sl: StatusLineConfig = { ...s.statusLine, command: inner };
    delete sl._ccUsageInstalled;
    delete sl._ccUsageOriginal;
    next.statusLine = sl;
    return next;
  }

  // Backward-compat: accept the old `echo -n " "` / `printf " "` shape too.
  const wrapMatch = cmd.match(/^sh -c '(.*); (?:echo -n|printf) " "; cc-usage-fetch[^']*'$/s);
  if (wrapMatch) {
    const inner = wrapMatch[1].replace(/'\\''/g, "'");
    const next: ClaudeSettings = { ...s };
    const sl: StatusLineConfig = { ...s.statusLine, command: inner };
    delete sl._ccUsageInstalled;
    delete sl._ccUsageOriginal;
    next.statusLine = sl;
    return next;
  }

  // Standalone form: cc-usage-fetch [args]
  const trimmed = cmd.trim();
  if (trimmed === FETCH_BIN || trimmed.startsWith(FETCH_BIN + ' ')) {
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
