import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeek } from '../../src/providers/deepseek';
import { parseStepFun } from '../../src/providers/stepfun';
import { parseSiliconFlow } from '../../src/providers/siliconflow';
import { parseOpenRouter } from '../../src/providers/openrouter';
import { parseNovita } from '../../src/providers/novita';

test('parseDeepSeek: prefers CNY entry from balance_infos', () => {
  const out = parseDeepSeek({
    balance_infos: [
      { currency: 'USD', total_balance: 1.5 },
      { currency: 'CNY', total_balance: 34.2 },
    ],
    is_available: true,
  });
  assert.ok(out);
  assert.equal(out!.kind, 'balance');
  assert.equal(out!.remaining, 34.2);
  assert.equal(out!.unit, 'CNY');
  assert.equal(out!.planName, 'DeepSeek');
  assert.equal(out!.isValid, true);
});

test('parseDeepSeek: CNY missing → falls back to first', () => {
  const out = parseDeepSeek({ balance_infos: [{ currency: 'USD', total_balance: 5.5 }] });
  assert.equal(out!.remaining, 5.5);
  assert.equal(out!.unit, 'USD');
});

test('parseDeepSeek: empty array → null', () => {
  assert.equal(parseDeepSeek({ balance_infos: [] }), null);
});

test('parseStepFun: numeric or string balance', () => {
  assert.equal(parseStepFun({ balance: 12.34 })!.remaining, 12.34);
  assert.equal(parseStepFun({ balance: '99.99' })!.remaining, 99.99);
  assert.equal(parseStepFun({}), null);
});

test('parseSiliconFlow: nested data.totalBalance', () => {
  const out = parseSiliconFlow({
    code: 200,
    data: { totalBalance: '20.50', balance: 10, chargeBalance: 10.5, status: 'normal' },
  });
  assert.equal(out!.remaining, 20.5);
  assert.equal(out!.unit, 'CNY');
  assert.equal(out!.planName, 'SiliconFlow');
});

test('parseSiliconFlow: missing data → null', () => {
  assert.equal(parseSiliconFlow({ code: 200 }), null);
});

test('parseOpenRouter: total - used = remaining', () => {
  const out = parseOpenRouter({ data: { total_credits: 10, total_usage: 4.12 } });
  assert.equal(out!.remaining, 5.88);
  assert.equal(out!.total, 10);
  assert.equal(out!.used, 4.12);
  assert.equal(out!.unit, 'USD');
  assert.equal(out!.isValid, true);
});

test('parseOpenRouter: flat shape (no data wrapper)', () => {
  const out = parseOpenRouter({ total_credits: 5, total_usage: 1 });
  assert.equal(out!.remaining, 4);
});

test('parseOpenRouter: zero remaining → invalid', () => {
  const out = parseOpenRouter({ data: { total_credits: 5, total_usage: 5 } });
  assert.equal(out!.isValid, false);
  assert.equal(out!.invalidMessage, 'No credits remaining');
});

test('parseNovita: availableBalance / 10000 → USD', () => {
  const out = parseNovita({ availableBalance: 53000 }); // = 5.30 USD
  assert.equal(out!.remaining, 5.3);
  assert.equal(out!.unit, 'USD');
  assert.equal(out!.planName, 'Novita');
  assert.equal(out!.isValid, true);
});

test('parseNovita: zero balance → invalid', () => {
  const out = parseNovita({ availableBalance: 0 });
  assert.equal(out!.isValid, false);
});

test('parseNovita: missing field → null', () => {
  assert.equal(parseNovita({}), null);
});
