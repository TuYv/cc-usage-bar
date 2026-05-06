import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD_RED = '\x1b[1;31m';

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

test('render: week color (>=80 bold red, else default)', () => {
  const lowWk = render({ five_hour: { utilization: 10 }, seven_day: { utilization: 79 } });
  assert.ok(!lowWk.includes(BOLD_RED));
  assert.ok(lowWk.endsWith('Wk 79%'));

  const highWk = render({ five_hour: { utilization: 10 }, seven_day: { utilization: 80 } });
  assert.ok(highWk.includes(BOLD_RED));
  assert.ok(highWk.endsWith(`${BOLD_RED}Wk 80%${RESET}`));
});

test('render: float utilization (stdin used_percentage) is rounded', () => {
  const out = render(
    { five_hour: { utilization: 23.5 }, seven_day: { utilization: 41.2 } },
    { color: false }
  );
  assert.equal(out, '5h 24% Wk 41%');
});

test('render: full output shape with colors at boundary', () => {
  const out = render({ five_hour: { utilization: 43 }, seven_day: { utilization: 21 } });
  assert.equal(out, `${GREEN}5h 43%${RESET} Wk 21%`);
});
