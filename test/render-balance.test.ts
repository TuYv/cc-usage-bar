import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNormalized } from '../src/render';

// These tests cover the rendering logic for balance / subscription shapes;
// they pin format to 'compact' so they are independent of whatever the
// global DEFAULT_FORMAT preset is set to (compact vs bar-countdown vs ...).
const compact = { format: 'compact' as const };

test('renderNormalized: balance with total + currency CNY', () => {
  const out = renderNormalized(
    { kind: 'balance', remaining: 5.88, total: 10, used: 4.12, unit: 'USD', planName: 'OpenRouter' },
    { color: false, showProviderName: true, ...compact }
  );
  assert.equal(out, 'OpenRouter $5.88/$10.00');
});

test('renderNormalized: balance without total + CNY', () => {
  const out = renderNormalized(
    { kind: 'balance', remaining: 34.2, unit: 'CNY', planName: 'DeepSeek' },
    { color: false, showProviderName: true, ...compact }
  );
  assert.equal(out, 'DeepSeek ¥34.20');
});

test('renderNormalized: balance without provider name', () => {
  const out = renderNormalized(
    { kind: 'balance', remaining: 12.5, unit: 'USD' },
    { color: false, showProviderName: false, ...compact }
  );
  assert.equal(out, '$12.50');
});

test('renderNormalized: invalid balance shows red message', () => {
  const out = renderNormalized(
    { kind: 'balance', remaining: 0, unit: 'USD', planName: 'OR', isValid: false, invalidMessage: 'No credits remaining' },
    { color: false, showProviderName: true, ...compact }
  );
  assert.equal(out, 'OR No credits remaining');
});

test('renderNormalized: subscription with provider name prefix', () => {
  const out = renderNormalized(
    {
      kind: 'subscription',
      planName: 'Kimi',
      five_hour: { utilization: 25 },
      seven_day: { utilization: 41 },
    },
    { color: false, showProviderName: true, ...compact }
  );
  assert.equal(out, 'Kimi 5h 25% Wk 41%');
});

test('renderNormalized: subscription without name (Anthropic default)', () => {
  const out = renderNormalized(
    {
      kind: 'subscription',
      planName: 'Anthropic',
      five_hour: { utilization: 40 },
      seven_day: { utilization: 59 },
    },
    { color: false, showProviderName: false, ...compact }
  );
  assert.equal(out, '5h 40% Wk 59%');
});

test('renderNormalized: unknown unit → falls back to "<num> <UNIT>" format', () => {
  const out = renderNormalized(
    { kind: 'balance', remaining: 100, unit: 'credits' },
    { color: false, ...compact }
  );
  assert.equal(out, '100.00 credits');
});

test('renderNormalized: null/undefined → empty', () => {
  assert.equal(renderNormalized(null), '');
  assert.equal(renderNormalized(undefined), '');
});
