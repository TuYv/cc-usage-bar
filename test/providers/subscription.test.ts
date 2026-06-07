import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnthropic } from '../../src/providers/anthropic';
import { parseKimi } from '../../src/providers/kimi';
import { parseGlm } from '../../src/providers/glm';
import { parseMinimax } from '../../src/providers/minimax';

test('parseAnthropic: official shape', () => {
  const out = parseAnthropic({
    five_hour: { utilization: 40, resets_at: '2026-05-06T07:40:00Z' },
    seven_day: { utilization: 59, resets_at: '2026-05-06T14:00:00Z' },
  });
  assert.ok(out);
  assert.equal(out!.kind, 'subscription');
  assert.equal(out!.five_hour?.utilization, 40);
  assert.equal(out!.seven_day?.utilization, 59);
});

test('parseAnthropic: missing both → null', () => {
  assert.equal(parseAnthropic({}), null);
  assert.equal(parseAnthropic(null), null);
});

test('parseKimi: limits[0].detail + usage → 5h + weekly', () => {
  const out = parseKimi({
    limits: [{ detail: { limit: 1000, remaining: 750, resetTime: '2026-05-06T18:00:00Z' } }],
    usage: { limit: 10000, remaining: 5900, resetTime: '2026-05-12T00:00:00Z' },
  });
  assert.ok(out);
  assert.equal(out!.planName, 'Kimi');
  assert.equal(out!.five_hour?.utilization, 25); // (1000-750)/1000*100
  assert.equal(out!.seven_day?.utilization, 41); // (10000-5900)/10000*100
  assert.equal(out!.five_hour?.resets_at, '2026-05-06T18:00:00Z');
});

test('parseKimi: numeric resetTime (epoch seconds) → ISO', () => {
  const out = parseKimi({
    limits: [{ detail: { limit: 100, remaining: 50, resetTime: 1738425600 } }],
  });
  assert.equal(out!.five_hour?.resets_at, new Date(1738425600 * 1000).toISOString());
});

test('parseKimi: zero limit → tier dropped (no divide-by-zero)', () => {
  const out = parseKimi({ limits: [{ detail: { limit: 0, remaining: 0 } }] });
  assert.equal(out, null);
});

test('parseGlm: TOKENS_LIMIT extraction with level metadata', () => {
  const out = parseGlm({
    success: true,
    data: {
      level: 'GLM-4.6-Pro',
      limits: [
        { type: 'OTHER', percentage: 99, nextResetTime: 0 },
        { type: 'TOKENS_LIMIT', percentage: 33.7, nextResetTime: 1738425600000 },
      ],
    },
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).planName, 'GLM GLM-4.6-Pro');
  assert.equal((out as any).five_hour?.utilization, 33.7);
  assert.equal((out as any).five_hour?.resets_at, new Date(1738425600000).toISOString());
  assert.equal((out as any).seven_day, undefined);
});

test('parseGlm: success=false → error envelope', () => {
  const out = parseGlm({ success: false, msg: 'invalid token' });
  assert.deepEqual(out, { error: 'invalid token' });
});

test('parseGlm: no TOKENS_LIMIT → null', () => {
  const out = parseGlm({ success: true, data: { limits: [{ type: 'OTHER', percentage: 50 }] } });
  assert.equal(out, null);
});

test('parseMinimax: general bucket 5h + weekly from remaining_percent', () => {
  // API reports REMAINING percent (0-100); usage = 100 - remaining.
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 98,
        current_weekly_remaining_percent: 95,
        current_interval_status: 1,
        current_weekly_status: 1,
        end_time: 1738425600000,
        weekly_end_time: 1738857600000,
      },
      { model_name: 'video', current_interval_remaining_percent: 100 },
    ],
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).planName, 'MiniMax');
  assert.equal((out as any).five_hour?.utilization, 2); // 100 - 98
  assert.equal((out as any).seven_day?.utilization, 5); // 100 - 95
  assert.equal((out as any).five_hour?.resets_at, new Date(1738425600000).toISOString());
  assert.equal((out as any).seven_day?.resets_at, new Date(1738857600000).toISOString());
});

test('parseMinimax: skips video, finds general in any position', () => {
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [
      { model_name: 'video', current_interval_remaining_percent: 50, current_weekly_remaining_percent: 50 },
      {
        model_name: 'general',
        current_interval_remaining_percent: 80,
        current_weekly_remaining_percent: 70,
        current_weekly_status: 1,
      },
    ],
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).five_hour?.utilization, 20); // general, not video
  assert.equal((out as any).seven_day?.utilization, 30);
});

test('parseMinimax: weekly_status != 1 → weekly tier skipped', () => {
  // No-weekly-cap plans report current_weekly_status=3 with remaining_percent stuck at 100.
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 99,
        end_time: 1738425600000,
        current_weekly_status: 3,
        current_weekly_remaining_percent: 100,
        weekly_end_time: 1738857600000,
      },
    ],
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).five_hour?.utilization, 1);
  assert.equal((out as any).seven_day, undefined);
});

test('parseMinimax: missing weekly percent (status 1) → weekly skipped', () => {
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 60, current_weekly_status: 1 },
    ],
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).five_hour?.utilization, 40);
  assert.equal((out as any).seven_day, undefined);
});

test('parseMinimax: negative / over-100 remaining passes through (no clamp)', () => {
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: -5,
        current_weekly_remaining_percent: 150,
        current_weekly_status: 1,
      },
    ],
  });
  assert.ok(out && 'kind' in out);
  assert.equal((out as any).five_hour?.utilization, 105); // 100 - (-5)
  assert.equal((out as any).seven_day?.utilization, -50); // 100 - 150
});

test('parseMinimax: no general entry → null', () => {
  const out = parseMinimax({
    base_resp: { status_code: 0 },
    model_remains: [{ model_name: 'video', current_interval_remaining_percent: 100 }],
  });
  assert.equal(out, null);
});

test('parseMinimax: business error → error envelope', () => {
  const out = parseMinimax({ base_resp: { status_code: 1004, status_msg: 'invalid_api_key' } });
  assert.deepEqual(out, { error: 'invalid_api_key' });
});

test('parseMinimax: empty model_remains → null', () => {
  assert.equal(parseMinimax({ base_resp: { status_code: 0 }, model_remains: [] }), null);
});
