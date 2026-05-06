import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAdapter } from '../../src/providers/registry';

const cases: Array<[string | undefined, string]> = [
  [undefined, 'anthropic'],
  ['', 'anthropic'],
  ['https://api.anthropic.com', 'anthropic'],
  ['https://api.kimi.com/coding', 'kimi'],
  ['https://api.z.ai', 'glm'],
  ['https://open.bigmodel.cn', 'glm'],
  ['https://api.minimaxi.com', 'minimax'],
  ['https://api.minimax.io', 'minimax'],
  ['https://api.deepseek.com', 'deepseek'],
  ['https://api.stepfun.com', 'stepfun'],
  ['https://api.stepfun.ai', 'stepfun'],
  ['https://api.siliconflow.cn', 'siliconflow'],
  ['https://api.siliconflow.com', 'siliconflow'],
  ['https://openrouter.ai/api/v1', 'openrouter'],
  ['https://api.novita.ai', 'novita'],
];

for (const [baseUrl, expected] of cases) {
  test(`selectAdapter: ${baseUrl ?? '<undefined>'} → ${expected}`, () => {
    const a = selectAdapter({ baseUrl });
    assert.ok(a, `expected adapter for ${baseUrl}`);
    assert.equal(a!.id, expected);
  });
}

test('selectAdapter: unknown provider → null', () => {
  assert.equal(selectAdapter({ baseUrl: 'https://api.fakellm.example' }), null);
});
