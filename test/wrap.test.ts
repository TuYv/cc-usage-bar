import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleLength, decideWrap, compose } from '../src/wrap';

test('visibleLength: plain ASCII counts as length', () => {
  assert.equal(visibleLength('hello'), 5);
});

test('visibleLength: strips ANSI CSI sequences', () => {
  // \x1b[1;34mhello\x1b[0m → "hello"
  assert.equal(visibleLength('\x1b[1;34mhello\x1b[0m'), 5);
});

test('visibleLength: counts UTF-8 box-drawing as one cell each', () => {
  // 10 bar blocks (3 bytes each in UTF-8) should be 10 chars, not 30
  assert.equal(visibleLength('██░░░░░░░░'), 10);
});

test('visibleLength: mixed ANSI + multibyte', () => {
  // ANSI green + 5 blocks + ANSI reset = 5
  assert.equal(visibleLength('\x1b[32m█████\x1b[0m'), 5);
});

test('visibleLength: CJK characters count as 2 cells each', () => {
  assert.equal(visibleLength('中文'), 4);
  assert.equal(visibleLength('日本語テスト'), 12);
  assert.equal(visibleLength('한국어'), 6);
});

test('visibleLength: common emoji count as 2 cells', () => {
  assert.equal(visibleLength('🚀'), 2);
  assert.equal(visibleLength('🎉🔥'), 4);
});

test('visibleLength: ASCII + CJK + ANSI mixed', () => {
  // "rick@host ~/源码 (m)" → 16 ASCII + 4 (源码 = 2 chars × 2 cells) = 20
  assert.equal(visibleLength('rick@host ~/源码 (m)'), 20);
  // ANSI wraps a CJK + ASCII string — width independent of color
  assert.equal(visibleLength('\x1b[1;34m中\x1b[0m a'), 4);
});

test('visibleLength: emoji ZWJ sequence counted as one wide cluster', () => {
  // 👨‍👩‍👧‍👦 (family) is one grapheme cluster but four emoji code points joined
  // by ZWJ. Different terminals render it as 2 cells (modern) or 8 cells
  // (per-emoji). We bias toward 2 (the modern norm) — accept either.
  const w = visibleLength('👨‍👩‍👧‍👦');
  assert.ok(w === 2 || w === 8, `expected 2 or 8, got ${w}`);
});

test('decideWrap: layout=single forces no wrap', () => {
  assert.equal(decideWrap('single', 'a'.repeat(200), 'b'.repeat(200), 80), false);
});

test('decideWrap: layout=multi forces wrap', () => {
  assert.equal(decideWrap('multi', 'a', 'b', 200), true);
});

test('decideWrap: auto with sufficient cols → single line', () => {
  // prefix=10, bar=10, sep=1 → total=21; cols=40 → fits
  assert.equal(decideWrap('auto', 'x'.repeat(10), 'y'.repeat(10), 40), false);
});

test('decideWrap: auto with tight cols → wrap', () => {
  // total=21, cols=20 → does not fit
  assert.equal(decideWrap('auto', 'x'.repeat(10), 'y'.repeat(10), 20), true);
});

test('decideWrap: auto when cols=0 (undetectable) → wrap (safe default)', () => {
  assert.equal(decideWrap('auto', 'short', 'short', 0), true);
});

test('decideWrap: empty prefix → single (only bar to emit, no need to wrap)', () => {
  assert.equal(decideWrap('auto', '', 'bar', 80), false);
});

test('decideWrap: empty bar → single (only prefix to emit)', () => {
  assert.equal(decideWrap('auto', 'prefix', '', 80), false);
});

test('decideWrap: ignores ANSI when measuring', () => {
  const prefix = '\x1b[1;34m' + 'x'.repeat(10) + '\x1b[0m'; // visible 10
  const bar = '\x1b[32m' + 'y'.repeat(10) + '\x1b[0m';      // visible 10
  // visible total 21, cols 30 → fits
  assert.equal(decideWrap('auto', prefix, bar, 30), false);
});

test('compose: both present, no wrap → joined by space', () => {
  assert.equal(compose('A', 'B', false), 'A B');
});

test('compose: both present, wrap → joined by newline', () => {
  assert.equal(compose('A', 'B', true), 'A\nB');
});

test('compose: only prefix → no separator', () => {
  assert.equal(compose('A', '', false), 'A');
  assert.equal(compose('A', '', true), 'A');
});

test('compose: only bar → no separator', () => {
  assert.equal(compose('', 'B', false), 'B');
  assert.equal(compose('', 'B', true), 'B');
});

test('compose: both empty → empty string', () => {
  assert.equal(compose('', '', false), '');
});
