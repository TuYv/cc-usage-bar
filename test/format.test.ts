import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExpiry,
  formatBar,
  parseBarSpec,
  renderUsage,
  DEFAULT_FORMAT,
  FormatOptions,
} from '../src/format';
import { SubscriptionUsage, BalanceUsage } from '../src/providers/types';

// Build dates in *local* tz so the same-day / week boundary is unambiguous
// regardless of the test runner's TZ. Using UTC ISO anchors leaks tz into the
// expected output via Date.getDate() / getHours().
function localIso(y: number, m: number, d: number, h = 0, mi = 0): string {
  return new Date(y, m - 1, d, h, mi).toISOString();
}
function localDate(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, m - 1, d, h, mi);
}

const NOW = localDate(2026, 5, 6, 10, 0); // local May 6 10:00
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';

function opts(over: Partial<FormatOptions> = {}): FormatOptions {
  return { ...DEFAULT_FORMAT, color: false, showProviderName: false, now: NOW, ...over };
}

// ---------- formatExpiry ----------

test('formatExpiry: same day → HH:MM', () => {
  assert.equal(formatExpiry(localIso(2026, 5, 6, 18, 23), NOW), '18:23');
});

test('formatExpiry: within a week → M/D HH:MM', () => {
  assert.equal(formatExpiry(localIso(2026, 5, 9, 9, 0), NOW), '5/9 09:00');
});

test('formatExpiry: more than a week → YYYY-MM-DD', () => {
  assert.equal(formatExpiry(localIso(2026, 6, 15, 9, 0), NOW), '2026-06-15');
});

test('formatExpiry: undefined / invalid → "?"', () => {
  assert.equal(formatExpiry(undefined, NOW), '?');
  assert.equal(formatExpiry('not a date', NOW), '?');
});

// ---------- formatBar ----------

test('formatBar: 0% → all empty', () => {
  assert.equal(formatBar(0, 10), '░░░░░░░░░░');
});

test('formatBar: 100% → all filled', () => {
  assert.equal(formatBar(100, 10), '██████████');
});

test('formatBar: 47% with width 10 → 5 filled', () => {
  assert.equal(formatBar(47, 10), '█████░░░░░');
});

test('formatBar: clamps out-of-range', () => {
  assert.equal(formatBar(-50, 5), '░░░░░');
  assert.equal(formatBar(200, 5), '█████');
});

test('parseBarSpec: accepts cells, tint, and frames specs', () => {
  assert.deepEqual(parseBarSpec('{"mode":"cells","filled":"#","empty":"-","width":4}'), {
    mode: 'cells',
    filled: '#',
    empty: '-',
    width: 4,
  });
  assert.deepEqual(parseBarSpec('{"mode":"tint","text":"Ciallo"}'), {
    mode: 'tint',
    text: 'Ciallo',
  });
  assert.deepEqual(parseBarSpec('{"mode":"frames","frames":["a","b"]}'), {
    mode: 'frames',
    frames: ['a', 'b'],
  });
});

test('parseBarSpec: rejects malformed specs', () => {
  assert.equal(parseBarSpec('not json'), null);
  assert.equal(parseBarSpec('{"mode":"cells","filled":"","empty":"-"}'), null);
  assert.equal(parseBarSpec('{"mode":"tint","text":""}'), null);
  assert.equal(parseBarSpec('{"mode":"frames","frames":["only"]}'), null);
});

// ---------- subscription presets ----------

const sub: SubscriptionUsage = {
  kind: 'subscription',
  five_hour: { utilization: 47, resets_at: localIso(2026, 5, 6, 18, 0) },
  seven_day: { utilization: 59, resets_at: localIso(2026, 5, 9, 9, 0) },
};

test('preset compact: 5h 47% Wk 59% (space sep)', () => {
  assert.equal(renderUsage(sub, opts({ format: 'compact' })), '5h 47% Wk 59%');
});

test('preset numeric: 47% / 59%', () => {
  assert.equal(renderUsage(sub, opts({ format: 'numeric' })), '47% / 59%');
});

test('preset time: 47% until 18:00 / 59% until 5/9 09:00', () => {
  assert.equal(
    renderUsage(sub, opts({ format: 'time' })),
    '47% until 18:00 / 59% until 5/9 09:00'
  );
});

test('preset bar: [bar] 47% / [bar] 59%', () => {
  assert.equal(
    renderUsage(sub, opts({ format: 'bar', barWidth: 10 })),
    '[█████░░░░░] 47% / [██████░░░░] 59%'
  );
});

test('bar spec cells: custom filled and empty characters', () => {
  assert.equal(
    renderUsage(sub, opts({
      format: 'bar',
      barSpec: { mode: 'cells', filled: '#', empty: '-', width: 8 },
    })),
    '[####----] 47% / [#####---] 59%'
  );
});

test('bar spec tint: keeps full text visible when colors are disabled', () => {
  assert.equal(
    renderUsage(sub, opts({
      format: 'bar',
      barSpec: { mode: 'tint', text: 'Ciallo~' },
    })),
    '[Ciallo~] 47% / [Ciallo~] 59%'
  );
});

test('bar spec tint: colors the completed prefix and dims the rest', () => {
  const partial: SubscriptionUsage = {
    kind: 'subscription',
    five_hour: { utilization: 50 },
  };
  assert.equal(
    renderUsage(partial, opts({
      color: true,
      format: 'bar',
      barSpec: { mode: 'tint', text: 'abcd' },
    })),
    `[${GREEN}ab${RESET}${DIM}cd${RESET}] 50%`
  );
});

test('bar spec frames: picks frame by utilization', () => {
  assert.equal(
    renderUsage(sub, opts({
      format: 'bar',
      barSpec: { mode: 'frames', frames: ['a', 'b', 'c', 'd'] },
    })),
    '[b] 47% / [c] 59%'
  );
});

test('preset bar-time: combines bar + percent + expiry', () => {
  assert.equal(
    renderUsage(sub, opts({ format: 'bar-time', barWidth: 5 })),
    '[██░░░] 47% until 18:00 / [███░░] 59% until 5/9 09:00'
  );
});

test('custom template overrides preset', () => {
  assert.equal(
    renderUsage(sub, opts({ template: '{label}={percent}% [{bar}] @{expiry}', barWidth: 4 })),
    '5h=47% [██░░] @18:00 / Wk=59% [██░░] @5/9 09:00'
  );
});

test('partial subscription (only 5h) renders alone', () => {
  const partial: SubscriptionUsage = { kind: 'subscription', five_hour: sub.five_hour };
  assert.equal(renderUsage(partial, opts({ format: 'numeric' })), '47%');
});

// ---------- balance ----------

const bal: BalanceUsage = {
  kind: 'balance',
  remaining: 5.88,
  total: 10,
  used: 4.12,
  unit: 'USD',
  planName: 'OpenRouter',
  isValid: true,
};

test('balance compact: $5.88/$10.00', () => {
  assert.equal(renderUsage(bal, opts({ format: 'compact' })), '$5.88/$10.00');
});

test('balance bar: uses (total-remaining)/total ratio', () => {
  assert.equal(
    renderUsage(bal, opts({ format: 'bar', barWidth: 10 })),
    '[████░░░░░░] $5.88/$10.00'
  );
});

test('balance without total: bar omitted', () => {
  const noTotal: BalanceUsage = {
    kind: 'balance',
    remaining: 34.2,
    unit: 'CNY',
    planName: 'DeepSeek',
  };
  assert.equal(renderUsage(noTotal, opts({ format: 'bar' })), '[] ¥34.20');
});

test('balance with provider name prefix', () => {
  assert.equal(
    renderUsage(bal, opts({ format: 'compact', showProviderName: true })),
    'OpenRouter $5.88/$10.00'
  );
});

test('balance invalid → red message (color off)', () => {
  const invalid: BalanceUsage = {
    kind: 'balance',
    remaining: 0,
    unit: 'USD',
    planName: 'OR',
    isValid: false,
    invalidMessage: 'No credits remaining',
  };
  assert.equal(
    renderUsage(invalid, opts({ format: 'bar', showProviderName: true })),
    'OR No credits remaining'
  );
});

test('null data → empty', () => {
  assert.equal(renderUsage(null, opts()), '');
});
