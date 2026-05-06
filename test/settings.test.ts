import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInstall,
  applyUninstallSurgical,
  isInstalled,
  ClaudeSettings,
} from '../src/settings';

test('applyInstall: empty settings → creates statusLine with cc-usage-fetch', () => {
  const out = applyInstall({});
  assert.equal(out.statusLine?.command, 'cc-usage-fetch');
  assert.equal(out.statusLine?.type, 'command');
  assert.equal(out.statusLine?.refreshInterval, 30);
  assert.equal(out.statusLine?._ccUsageInstalled, true);
  assert.equal(out.statusLine?._ccUsageOriginal, undefined);
});

test('applyInstall: existing custom command → routed through cc-usage-bar-wrap, original preserved', () => {
  const orig = 'sh /home/me/statusline.sh';
  const out = applyInstall({ statusLine: { type: 'command', command: orig } });
  assert.equal(out.statusLine!.command!, `cc-usage-bar-wrap --prefix='${orig}'`);
  assert.equal(out.statusLine?._ccUsageInstalled, true);
  assert.equal(out.statusLine?._ccUsageOriginal, orig);
});

test('applyInstall: existing prefix + flags → wrap form carries flags through', () => {
  const orig = 'sh /home/me/statusline.sh';
  const out = applyInstall(
    { statusLine: { command: orig } },
    { format: 'bar-countdown', barWidth: 12 }
  );
  assert.equal(
    out.statusLine!.command!,
    `cc-usage-bar-wrap --prefix='${orig}' --format=bar-countdown --bar-width=12`
  );
});

test('applyUninstallSurgical: legacy v0.1.0 echo -n form still unwraps', () => {
  const orig = 'sh /custom.sh';
  const legacyWrapped: ClaudeSettings = {
    statusLine: { command: `sh -c '${orig}; echo -n " "; cc-usage-fetch --format=bar-time'` },
  };
  const out = applyUninstallSurgical(legacyWrapped);
  assert.equal(out.statusLine?.command, orig);
});

test("applyInstall: command containing single-quote → safely escaped, round-trips", () => {
  const orig = `echo 'hello world'`;
  const out = applyInstall({ statusLine: { command: orig } });
  // The `'\''` pattern is the standard sh-quote-escape
  assert.ok(out.statusLine!.command!.includes(`'\\''`));
  assert.equal(out.statusLine?._ccUsageOriginal, orig);

  // And uninstall recovers the exact original even after the marker is dropped
  delete out.statusLine!._ccUsageInstalled;
  delete out.statusLine!._ccUsageOriginal;
  const restored = applyUninstallSurgical(out);
  assert.equal(restored.statusLine?.command, orig);
});

test('applyInstall: re-install (idempotent) → unwraps prior, then re-wraps', () => {
  const orig = 'sh /custom.sh';
  const once = applyInstall({ statusLine: { command: orig } });
  const twice = applyInstall(once);
  assert.equal(twice.statusLine?._ccUsageOriginal, orig);
  const wrapCount = (twice.statusLine!.command!.match(/cc-usage-bar-wrap/g) || []).length;
  assert.equal(wrapCount, 1, 'must not nest: exactly one wrapper invocation');
});

test('applyInstall: re-install when prior had no original → falls back to fresh install', () => {
  const prior: ClaudeSettings = {
    statusLine: { command: 'cc-usage-fetch', _ccUsageInstalled: true },
  };
  const out = applyInstall(prior);
  assert.equal(out.statusLine?.command, 'cc-usage-fetch');
  assert.equal(out.statusLine?._ccUsageInstalled, true);
});

test('applyInstall: persists bar spec as a fetch argument', () => {
  const barSpec = '{"mode":"tint","text":"Ciallo~"}';
  const out = applyInstall({}, { format: 'bar-time', barSpec });
  assert.equal(
    out.statusLine?.command,
    `cc-usage-fetch --format=bar-time --bar-spec='${barSpec}'`
  );
});

test('applyInstall: preserves unrelated top-level fields', () => {
  const input: ClaudeSettings = { model: 'claude-opus-4-7', env: { FOO: 'bar' } };
  const out = applyInstall(input);
  assert.equal(out.model, 'claude-opus-4-7');
  assert.deepEqual(out.env, { FOO: 'bar' });
});

test('isInstalled: detects marker', () => {
  assert.equal(isInstalled({}), false);
  assert.equal(isInstalled({ statusLine: { command: 'foo' } }), false);
  assert.equal(isInstalled({ statusLine: { command: 'foo', _ccUsageInstalled: true } }), true);
});

test('applyUninstallSurgical: wrapped command → unwraps to original', () => {
  const orig = 'sh /custom.sh';
  const wrapped = applyInstall({ statusLine: { command: orig } });
  // Simulate user manually removed the marker (so backup-restore path can't run)
  delete wrapped.statusLine!._ccUsageInstalled;
  delete wrapped.statusLine!._ccUsageOriginal;
  const out = applyUninstallSurgical(wrapped);
  assert.equal(out.statusLine?.command, orig);
});

test('applyUninstallSurgical: wrapped command with bar spec → unwraps to original', () => {
  const orig = 'sh /custom.sh';
  const wrapped = applyInstall(
    { statusLine: { command: orig } },
    { format: 'bar-time', barSpec: '{"mode":"tint","text":"Ciallo~"}' }
  );
  delete wrapped.statusLine!._ccUsageInstalled;
  delete wrapped.statusLine!._ccUsageOriginal;
  const out = applyUninstallSurgical(wrapped);
  assert.equal(out.statusLine?.command, orig);
});

test('applyUninstallSurgical: solo cc-usage-fetch → removes statusLine entirely', () => {
  const out = applyUninstallSurgical({
    statusLine: { type: 'command', command: 'cc-usage-fetch' },
  });
  assert.equal(out.statusLine, undefined);
});

test('applyUninstallSurgical: solo cc-usage-bar-wrap (no prefix) → removes statusLine entirely', () => {
  const out = applyUninstallSurgical({
    statusLine: { type: 'command', command: 'cc-usage-bar-wrap --format=bar-countdown' },
  });
  assert.equal(out.statusLine, undefined);
});

test('applyUninstallSurgical: v0.2-0.3 printf-$() form still unwraps', () => {
  const orig = 'sh /custom.sh';
  const wrapped: ClaudeSettings = {
    statusLine: { command: `sh -c 'printf "%s " "$(${orig})"; cc-usage-fetch --format=bar-time'` },
  };
  const out = applyUninstallSurgical(wrapped);
  assert.equal(out.statusLine?.command, orig);
});

test('applyInstall: Windows uses double-quoting (single-quotes are literal in cmd.exe)', () => {
  const orig = 'powershell -NoProfile -File C:\\Users\\me\\statusline.ps1';
  const out = applyInstall({ statusLine: { command: orig } }, { format: 'bar-countdown' }, 'win32');
  assert.equal(
    out.statusLine!.command!,
    `cc-usage-bar-wrap --prefix="${orig}" --format=bar-countdown`
  );
});

test('applyInstall: Windows escapes embedded double-quotes', () => {
  const orig = 'powershell -Command "Write-Host hi"';
  const out = applyInstall({ statusLine: { command: orig } }, {}, 'win32');
  // Internal " becomes \"
  assert.equal(
    out.statusLine!.command!,
    `cc-usage-bar-wrap --prefix="powershell -Command \\"Write-Host hi\\""`
  );
});

test('applyUninstallSurgical: Windows-quoted wrap form unwraps to original', () => {
  const orig = 'powershell -NoProfile -File C:\\Users\\me\\statusline.ps1';
  const installed = applyInstall({ statusLine: { command: orig } }, {}, 'win32');
  delete installed.statusLine!._ccUsageInstalled;
  delete installed.statusLine!._ccUsageOriginal;
  const out = applyUninstallSurgical(installed);
  assert.equal(out.statusLine?.command, orig);
});

test('applyInstall: marker-less wrap command treated as prior install, not as new prefix', () => {
  // Simulates a manual / AI-driven install (per AGENTS.md) that did not set the marker.
  const trueOriginal = 'sh /home/me/statusline.sh';
  const manuallyWritten: ClaudeSettings = {
    statusLine: {
      command: `cc-usage-bar-wrap --prefix='${trueOriginal}' --format=bar-time`,
    },
  };
  const out = applyInstall(manuallyWritten, { format: 'bar-countdown' });
  // Must NOT nest cc-usage-bar-wrap; the original prefix must be recovered.
  const wrapCount = (out.statusLine!.command!.match(/cc-usage-bar-wrap/g) || []).length;
  assert.equal(wrapCount, 1, 'must not nest wrap inside wrap');
  assert.equal(out.statusLine?._ccUsageOriginal, trueOriginal);
});

test('applyInstall: marker-less bare cc-usage-fetch command treated as no-prefix install', () => {
  const manuallyWritten: ClaudeSettings = {
    statusLine: { command: 'cc-usage-fetch --format=bar-time' },
  };
  const out = applyInstall(manuallyWritten, { format: 'bar-countdown' });
  // Strip recognises a standalone cc-usage-fetch as having no prefix → fresh bare install.
  assert.equal(out.statusLine?.command, 'cc-usage-fetch --format=bar-countdown');
  assert.equal(out.statusLine?._ccUsageOriginal, undefined);
});

test('applyUninstallSurgical: command without cc-usage-fetch → no-op', () => {
  const input: ClaudeSettings = { statusLine: { command: 'sh /other.sh' } };
  const out = applyUninstallSurgical(input);
  assert.deepEqual(out, input);
});

test('install → uninstall round-trip preserves original (via surgical)', () => {
  const orig = `echo 'a b' && date`;
  const after = applyInstall({ statusLine: { command: orig, type: 'command' } });
  delete after.statusLine!._ccUsageInstalled;
  delete after.statusLine!._ccUsageOriginal;
  const restored = applyUninstallSurgical(after);
  assert.equal(restored.statusLine?.command, orig);
});
