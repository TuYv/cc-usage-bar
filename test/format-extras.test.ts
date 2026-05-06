import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdown,
  parseColorRamp,
  colorFromRamp,
  renderUsage,
  DEFAULT_FORMAT,
  COLOR_MAP,
  FormatOptions,
  hexToAnsi,
} from '../src/format';
import { SubscriptionUsage } from '../src/providers/types';

const RESET = '\x1b[0m';
const NOW = new Date('2026-05-06T10:00:00.000Z');

function opts(over: Partial<FormatOptions> = {}): FormatOptions {
  return { ...DEFAULT_FORMAT, color: false, showProviderName: false, now: NOW, ...over };
}

// ---------- formatCountdown ----------

test('formatCountdown: <1m → seconds', () => {
  assert.equal(formatCountdown('2026-05-06T10:00:30.000Z', NOW), '30s');
});

test('formatCountdown: <1h → minutes', () => {
  assert.equal(formatCountdown('2026-05-06T10:23:00.000Z', NOW), '23m');
});

test('formatCountdown: <24h → hours[+minutes]', () => {
  assert.equal(formatCountdown('2026-05-06T11:23:00.000Z', NOW), '1h23m');
  assert.equal(formatCountdown('2026-05-06T12:00:00.000Z', NOW), '2h');
});

test('formatCountdown: ≥24h → days[+hours]', () => {
  assert.equal(formatCountdown('2026-05-08T16:00:00.000Z', NOW), '2d6h');
  assert.equal(formatCountdown('2026-05-08T10:00:00.000Z', NOW), '2d');
});

test('formatCountdown: past time → 0s', () => {
  assert.equal(formatCountdown('2026-05-06T09:00:00.000Z', NOW), '0s');
});

test('formatCountdown: invalid / undefined → "?"', () => {
  assert.equal(formatCountdown(undefined, NOW), '?');
  assert.equal(formatCountdown('not a date', NOW), '?');
});

// ---------- parseColorRamp ----------

test('parseColorRamp: single rule resolves to ansi', () => {
  assert.deepEqual(parseColorRamp('0:green'), [{ min: 0, ansi: COLOR_MAP.green }]);
});

test('parseColorRamp: multiple rules sorted ascending', () => {
  assert.deepEqual(parseColorRamp('85:red,0:green,60:yellow'), [
    { min: 0, ansi: COLOR_MAP.green },
    { min: 60, ansi: COLOR_MAP.yellow },
    { min: 85, ansi: COLOR_MAP.red },
  ]);
});

test('parseColorRamp: accepts decimal thresholds', () => {
  assert.deepEqual(parseColorRamp('0.5:dim,99.9:boldRed'), [
    { min: 0.5, ansi: COLOR_MAP.dim },
    { min: 99.9, ansi: COLOR_MAP.boldRed },
  ]);
});

test('parseColorRamp: accepts "none" as opt-out (stored as null ansi)', () => {
  assert.deepEqual(parseColorRamp('0:none,80:red'), [
    { min: 0, ansi: null },
    { min: 80, ansi: COLOR_MAP.red },
  ]);
});

test('parseColorRamp: rejects unknown color names', () => {
  assert.equal(parseColorRamp('0:fuchsia'), null);
});

test('parseColorRamp: rejects malformed entries', () => {
  assert.equal(parseColorRamp('green'), null);
  assert.equal(parseColorRamp(':green'), null);
  assert.equal(parseColorRamp('0:'), null);
  assert.equal(parseColorRamp(''), null);
  assert.equal(parseColorRamp(undefined), null);
});

// ---------- colorFromRamp ----------

test('colorFromRamp: picks last matching threshold', () => {
  const ramp = parseColorRamp('0:green,60:yellow,85:red')!;
  assert.equal(colorFromRamp(0, ramp), COLOR_MAP.green);
  assert.equal(colorFromRamp(59, ramp), COLOR_MAP.green);
  assert.equal(colorFromRamp(60, ramp), COLOR_MAP.yellow);
  assert.equal(colorFromRamp(84, ramp), COLOR_MAP.yellow);
  assert.equal(colorFromRamp(85, ramp), COLOR_MAP.red);
  assert.equal(colorFromRamp(100, ramp), COLOR_MAP.red);
});

test('colorFromRamp: "none" band yields null (no color applied)', () => {
  const ramp = parseColorRamp('0:none,80:red')!;
  assert.equal(colorFromRamp(50, ramp), null);
  assert.equal(colorFromRamp(80, ramp), COLOR_MAP.red);
});

test('colorFromRamp: utilization below first threshold → null', () => {
  const ramp = parseColorRamp('30:yellow')!;
  assert.equal(colorFromRamp(10, ramp), null);
  assert.equal(colorFromRamp(30, ramp), COLOR_MAP.yellow);
});

// ---------- hex color support ----------

test('hexToAnsi: full #RRGGBB → 24-bit ANSI', () => {
  assert.equal(hexToAnsi('#ff8000'), '\x1b[38;2;255;128;0m');
});

test('hexToAnsi: shorthand #RGB expands each digit', () => {
  // #f80 → r=ff(255) g=88(136) b=00(0)
  assert.equal(hexToAnsi('#f80'), '\x1b[38;2;255;136;0m');
});

test('hexToAnsi: case insensitive', () => {
  assert.equal(hexToAnsi('#AaBbCc'), '\x1b[38;2;170;187;204m');
});

test('hexToAnsi: rejects bad hex', () => {
  assert.equal(hexToAnsi('#xyz'), null);
  assert.equal(hexToAnsi('ff0000'), null);
  assert.equal(hexToAnsi('#1234'), null);
  assert.equal(hexToAnsi('#1'), null);
  assert.equal(hexToAnsi(''), null);
});

test('parseColorRamp: accepts hex tokens (resolved to truecolor escapes)', () => {
  assert.deepEqual(parseColorRamp('0:#000,60:#ffaa00,90:#ff3333'), [
    { min: 0, ansi: '\x1b[38;2;0;0;0m' },
    { min: 60, ansi: '\x1b[38;2;255;170;0m' },
    { min: 90, ansi: '\x1b[38;2;255;51;51m' },
  ]);
});

test('parseColorRamp: mixed named + hex + none', () => {
  assert.deepEqual(parseColorRamp('0:none,40:#00aaff,80:boldRed'), [
    { min: 0, ansi: null },
    { min: 40, ansi: '\x1b[38;2;0;170;255m' },
    { min: 80, ansi: COLOR_MAP.boldRed },
  ]);
});

test('parseColorRamp: rejects malformed hex', () => {
  assert.equal(parseColorRamp('0:#xyz'), null);
  assert.equal(parseColorRamp('0:#1234'), null);
});

test('colorFromRamp: hex resolves to truecolor escape', () => {
  const ramp = parseColorRamp('0:#101010,80:#ff3333')!;
  assert.equal(colorFromRamp(0, ramp), '\x1b[38;2;16;16;16m');
  assert.equal(colorFromRamp(90, ramp), '\x1b[38;2;255;51;51m');
});

// ---------- preset countdown / bar-countdown ----------

const sub: SubscriptionUsage = {
  kind: 'subscription',
  five_hour: { utilization: 47, resets_at: '2026-05-06T11:23:00.000Z' }, // +1h23m
  seven_day: { utilization: 59, resets_at: '2026-05-08T16:00:00.000Z' }, // +2d6h
};

test('preset countdown: "47% in 1h23m / 59% in 2d6h"', () => {
  assert.equal(renderUsage(sub, opts({ format: 'countdown' })), '47% in 1h23m / 59% in 2d6h');
});

test('preset bar-countdown: includes both bar and countdown', () => {
  assert.equal(
    renderUsage(sub, opts({ format: 'bar-countdown', barWidth: 5 })),
    '[██░░░] 47% in 1h23m / [███░░] 59% in 2d6h'
  );
});

// ---------- per-tier ramp customization ----------

test('renderTier: custom 5h ramp turns 5h blue when configured', () => {
  const out = renderUsage(sub, opts({
    color: true,
    format: 'compact',
    colorRamp5h: parseColorRamp('0:blue,99:red')!,
  }));
  assert.ok(out.startsWith(COLOR_MAP.blue), 'expected blue prefix on 5h');
  assert.ok(out.endsWith(`${RESET}`));
});

test('renderTier: custom Wk ramp boldRed at high band', () => {
  const high: SubscriptionUsage = {
    kind: 'subscription',
    five_hour: { utilization: 10 },
    seven_day: { utilization: 95 },
  };
  const out = renderUsage(high, opts({
    color: true,
    format: 'compact',
    colorRampWk: parseColorRamp('0:none,90:boldRed')!,
  }));
  assert.ok(out.includes(`${COLOR_MAP.boldRed}Wk 95%${RESET}`));
});

test('renderTier: tint bar respects per-tier color (Wk now colored)', () => {
  const out = renderUsage(
    {
      kind: 'subscription',
      five_hour: { utilization: 50 },
      seven_day: { utilization: 50 },
    },
    opts({
      color: true,
      format: 'bar',
      barSpec: { mode: 'tint', text: 'AB' },
    })
  );
  // Both tiers should colorize the active part of the tint bar
  // 5h: A active, B inactive; Wk: same
  // Each tier renders as: [<active><inactive>] 50%
  // Active is wrapped in green (50% < 60 default)
  const greenA = `${COLOR_MAP.green}A${RESET}`;
  const dimB = `${COLOR_MAP.dim}B${RESET}`;
  const tile = `[${greenA}${dimB}] 50%`;
  assert.equal(out, `${tile} / ${tile}`);
});
