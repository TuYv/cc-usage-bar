import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromStdin } from '../src/fetch';

test('extractFromStdin: official Claude Code shape → normalized UsageData', () => {
  const stdin = {
    model: { id: 'claude-opus-4-7' },
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
      seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
    },
  };
  const out = extractFromStdin(stdin);
  assert.ok(out);
  assert.equal(out!.five_hour?.utilization, 23.5);
  assert.equal(out!.seven_day?.utilization, 41.2);
  assert.equal(out!.five_hour?.resets_at, new Date(1738425600 * 1000).toISOString());
  assert.equal(out!.seven_day?.resets_at, new Date(1738857600 * 1000).toISOString());
});

test('extractFromStdin: only five_hour present (independent absence)', () => {
  const out = extractFromStdin({
    rate_limits: { five_hour: { used_percentage: 50, resets_at: 1738425600 } },
  });
  assert.ok(out);
  assert.equal(out!.five_hour?.utilization, 50);
  assert.equal(out!.seven_day, undefined);
});

test('extractFromStdin: only seven_day present', () => {
  const out = extractFromStdin({
    rate_limits: { seven_day: { used_percentage: 60, resets_at: 1738857600 } },
  });
  assert.ok(out);
  assert.equal(out!.seven_day?.utilization, 60);
  assert.equal(out!.five_hour, undefined);
});

test('extractFromStdin: rate_limits absent (free tier / first turn) → null', () => {
  assert.equal(extractFromStdin({ model: 'foo' }), null);
});

test('extractFromStdin: rate_limits is empty object → null', () => {
  assert.equal(extractFromStdin({ rate_limits: {} }), null);
});

test('extractFromStdin: malformed input → null (does not throw)', () => {
  assert.equal(extractFromStdin(null), null);
  assert.equal(extractFromStdin(undefined), null);
  assert.equal(extractFromStdin('not an object'), null);
  assert.equal(extractFromStdin(42), null);
  assert.equal(extractFromStdin({ rate_limits: 'wrong type' }), null);
  assert.equal(extractFromStdin({ rate_limits: { five_hour: 'wrong' } }), null);
});

test('extractFromStdin: missing used_percentage → that tier dropped', () => {
  const out = extractFromStdin({
    rate_limits: {
      five_hour: { resets_at: 1738425600 }, // no used_percentage → dropped
      seven_day: { used_percentage: 30 },
    },
  });
  assert.ok(out);
  assert.equal(out!.five_hour, undefined);
  assert.equal(out!.seven_day?.utilization, 30);
});

test('extractFromStdin: resets_at as ISO string (defensive) is passed through', () => {
  const out = extractFromStdin({
    rate_limits: {
      five_hour: { used_percentage: 50, resets_at: '2026-05-06T18:23:00Z' },
    },
  });
  assert.equal(out!.five_hour?.resets_at, '2026-05-06T18:23:00Z');
});

test('extractFromStdin: missing resets_at → utilization still present', () => {
  const out = extractFromStdin({
    rate_limits: { five_hour: { used_percentage: 50 } },
  });
  assert.equal(out!.five_hour?.utilization, 50);
  assert.equal(out!.five_hour?.resets_at, undefined);
});

test('extractFromStdin: NaN/Infinity used_percentage → tier dropped', () => {
  const out = extractFromStdin({
    rate_limits: {
      five_hour: { used_percentage: NaN },
      seven_day: { used_percentage: Infinity },
    },
  });
  assert.equal(out, null);
});
