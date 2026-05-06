import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

test('render: empty / null data returns empty string', () => {
  assert.equal(render(null), '');
  assert.equal(render(undefined), '');
  assert.equal(render({}), '');
  assert.equal(render({ five_hour: {} }), '');
});

test('render: only five_hour present → renders just 5h (permissive)', () => {
  const out = render({ five_hour: { utilization: 50 } }, { color: false });
  assert.equal(out, '5h 50%');
});

test('render: only seven_day present → renders just Wk', () => {
  const out = render({ seven_day: { utilization: 30 } }, { color: false });
  assert.equal(out, 'Wk 30%');
});

test('render: plain mode strips colors', () => {
  const out = render(
    { five_hour: { utilization: 43 }, seven_day: { utilization: 21 } },
    { color: false }
  );
  assert.equal(out, '5h 43% Wk 21%');
});

test('render: 5h color thresholds (<60 green, <85 yellow, >=85 red)', () => {
  const make = (u: number) =>
    render({ five_hour: { utilization: u }, seven_day: { utilization: 10 } });
  assert.ok(make(0).startsWith(GREEN));
  assert.ok(make(59).startsWith(GREEN));
  assert.ok(make(60).startsWith(YELLOW));
  assert.ok(make(84).startsWith(YELLOW));
  assert.ok(make(85).startsWith(RED));
  assert.ok(make(100).startsWith(RED));
});

test('render: weekly tier now also colored using same default ramp', () => {
  const lowWk = render({ five_hour: { utilization: 10 }, seven_day: { utilization: 10 } });
  // 5h piece is green-wrapped, Wk piece must also be green-wrapped
  assert.ok(lowWk.includes(`${GREEN}Wk 10%${RESET}`));
});

test('render: weekly tier yellow band (>=60, <85)', () => {
  const out = render({ five_hour: { utilization: 10 }, seven_day: { utilization: 70 } });
  assert.ok(out.includes(`${YELLOW}Wk 70%${RESET}`));
});

test('render: weekly tier red band (>=85)', () => {
  const out = render({ five_hour: { utilization: 10 }, seven_day: { utilization: 90 } });
  assert.ok(out.includes(`${RED}Wk 90%${RESET}`));
});

test('render: float utilization (stdin used_percentage) is rounded', () => {
  const out = render(
    { five_hour: { utilization: 23.5 }, seven_day: { utilization: 41.2 } },
    { color: false }
  );
  assert.equal(out, '5h 24% Wk 41%');
});

test('render: full output shape with colors on both tiers', () => {
  const out = render({ five_hour: { utilization: 43 }, seven_day: { utilization: 21 } });
  assert.equal(out, `${GREEN}5h 43%${RESET} ${GREEN}Wk 21%${RESET}`);
});
