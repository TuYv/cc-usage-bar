import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  readSettings,
  writeSettings,
  backupSettings,
  findLatestBackup,
  applyInstall,
  applyUninstallSurgical,
  restoreFromBackup,
  deleteBackups,
  isInstalled,
  claudeDirExists,
  SETTINGS_PATH,
  SettingsError,
  InstallOptions,
} from './settings';
import { run } from './fetch';
import { isValidPreset, FORMAT_PRESETS, parseBarSpec } from './format';

function readPkgVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatCountdown(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 'unknown';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';
  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function loadSettingsOrExit() {
  try {
    return readSettings();
  } catch (e) {
    if (e instanceof SettingsError) {
      console.error(`error: ${e.message}`);
      if (e.hint) console.error(`hint:  ${e.hint}`);
      process.exit(1);
    }
    throw e;
  }
}

async function runInstall(force: boolean, installOpts: InstallOptions): Promise<void> {
  if (!claudeDirExists()) {
    console.error(
      'No ~/.claude/ directory found. Install Claude Code and run `claude` to log in first.'
    );
    process.exit(1);
  }

  const settings = loadSettingsOrExit();

  if (isInstalled(settings) && !force) {
    console.log(
      'Already installed. Run `cc-usage-statusline uninstall` first, or pass --force to reinstall.'
    );
    return;
  }

  const backup = backupSettings();
  const next = applyInstall(settings, installOpts);
  writeSettings(next);

  console.log(`✓ Updated ${SETTINGS_PATH}`);
  if (backup) console.log(`✓ Backup:  ${backup}`);

  process.stdout.write('Verifying… ');
  const result = await run({ forceFresh: true, skipStdin: true });
  if (result.data) {
    const summary =
      result.data.kind === 'subscription'
        ? `5h ${Math.round(result.data.five_hour?.utilization ?? 0)}% / 7d ${Math.round(result.data.seven_day?.utilization ?? 0)}%`
        : `${result.data.remaining.toFixed(2)} ${result.data.unit}`;
    console.log(`OK [${result.adapterId}] ${summary}`);
    console.log('Restart Claude Code to see the statusline.');
    return;
  }

  console.log('FAIL');
  if (!result.adapterId) {
    console.error('  → No matching provider. Check ANTHROPIC_BASE_URL.');
  } else if (result.authFailed) {
    console.error('  → Auth failed. Re-login with `claude` (Anthropic) or check ANTHROPIC_AUTH_TOKEN.');
  } else if (result.error) {
    console.error(`  → ${result.error}`);
  }
  console.error(
    '(Settings were still updated. Run `cc-usage-statusline status` to retry diagnostics.)'
  );
}

async function runUninstall(): Promise<void> {
  if (!claudeDirExists()) {
    console.log('Nothing to do — no ~/.claude/ directory.');
    return;
  }

  const settings = loadSettingsOrExit();

  if (isInstalled(settings)) {
    const latest = findLatestBackup();
    if (latest) {
      restoreFromBackup(latest);
      const removed = deleteBackups();
      console.log(`✓ Restored from backup: ${latest}`);
      console.log(`✓ Cleaned up ${removed} backup file(s).`);
      console.log('Restart Claude Code for changes to take effect.');
      return;
    }
  }

  const next = applyUninstallSurgical(settings);
  writeSettings(next);
  const removed = deleteBackups();
  console.log('✓ Removed cc-usage-fetch from statusLine (surgical mode).');
  if (removed > 0) console.log(`✓ Cleaned up ${removed} backup file(s).`);
  console.log('Restart Claude Code for changes to take effect.');
}

async function runStatus(): Promise<void> {
  const result = await run({ forceFresh: true, skipStdin: true });
  console.log(`provider:      ${result.adapterId ?? '<none>'}`);
  console.log(`source:        ${result.source}`);
  console.log(`cache status:  ${result.cacheStatus}`);
  console.log(`base url:      ${process.env.ANTHROPIC_BASE_URL ?? '<not set, defaults to anthropic>'}`);
  if (result.error) console.log(`error:         ${result.error}`);
  if (result.authFailed) {
    console.log('→ Auth failed. Re-login (Anthropic) or check ANTHROPIC_AUTH_TOKEN.');
    return;
  }
  if (!result.data) {
    if (!result.adapterId) {
      console.log('→ Configure ANTHROPIC_BASE_URL to a supported provider, or leave unset for Anthropic.');
    }
    return;
  }
  if (result.data.kind === 'subscription') {
    const fh = result.data.five_hour;
    const wk = result.data.seven_day;
    if (result.data.planName) console.log(`plan:          ${result.data.planName}`);
    if (fh) console.log(`5-hour:        ${Math.round(fh.utilization)}% (resets in ${formatCountdown(fh.resets_at)})`);
    if (wk) console.log(`7-day:         ${Math.round(wk.utilization)}% (resets in ${formatCountdown(wk.resets_at)})`);
  } else {
    const d = result.data;
    if (d.planName) console.log(`plan:          ${d.planName}`);
    console.log(`remaining:     ${d.remaining.toFixed(2)} ${d.unit}`);
    if (typeof d.total === 'number') console.log(`total:         ${d.total.toFixed(2)} ${d.unit}`);
    if (typeof d.used === 'number') console.log(`used:          ${d.used.toFixed(2)} ${d.unit}`);
  }
}

const program = new Command();
program
  .name('cc-usage-statusline')
  .description('Show your Claude Code subscription usage in the statusline.')
  .version(readPkgVersion());

program
  .command('install')
  .description('Install statusline integration into ~/.claude/settings.json')
  .option('-f, --force', 'overwrite if already installed')
  .option(
    '--format <preset>',
    `render preset (${FORMAT_PRESETS.join(' | ')})`,
    'compact'
  )
  .option('--bar-width <n>', 'bar width when format includes a bar (1-50)', '10')
  .option('--bar-spec <json>', 'custom bar JSON spec (cells, tint, or frames)')
  .action(async (opts: { force?: boolean; format?: string; barWidth?: string; barSpec?: string }) => {
    const installOpts: InstallOptions = {};
    if (opts.format && opts.format !== 'compact') {
      if (!isValidPreset(opts.format)) {
        console.error(`error: --format must be one of ${FORMAT_PRESETS.join(', ')}`);
        process.exit(1);
      }
      installOpts.format = opts.format;
    }
    if (opts.barWidth) {
      const n = parseInt(opts.barWidth, 10);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        console.error('error: --bar-width must be 1..50');
        process.exit(1);
      }
      // Only persist if non-default to keep command tidy
      if (n !== 10) installOpts.barWidth = n;
    }
    if (opts.barSpec) {
      if (!parseBarSpec(opts.barSpec)) {
        console.error('error: --bar-spec must be valid cells, tint, or frames JSON');
        process.exit(1);
      }
      installOpts.barSpec = opts.barSpec;
    }
    await runInstall(!!opts.force, installOpts);
  });

program
  .command('uninstall')
  .description('Remove statusline integration; restore from backup if possible')
  .action(async () => {
    await runUninstall();
  });

program
  .command('status')
  .description('Diagnose: token source, current usage, reset countdowns, cache state')
  .action(async () => {
    await runStatus();
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
