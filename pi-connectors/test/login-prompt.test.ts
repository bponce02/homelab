import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthPrompt } from '@earendil-works/pi-ai';
import { answerLoginPrompt } from '../src/login-prompt.ts';

const menu: AuthPrompt = {
  type: 'select', message: 'Select login method:', options: [
    { id: 'browser', label: 'Browser login (default)' },
    { id: 'device_code', label: 'Device code login (headless)' },
  ],
};

test('OAuth selection returns provider IDs for numbers, defaults, and explicit IDs', async () => {
  for (const [input, expected] of [['', 'browser'], ['1', 'browser'], ['2', 'device_code'], [' device_code ', 'device_code']]) {
    const selected = await answerLoginPrompt(menu, async text => {
      assert.ok(text.includes('2. Device code login (headless)'));
      return input;
    });
    assert.equal(selected, expected);
  }
});

test('invalid OAuth choices retry without falling through to a login method', async () => {
  const values = ['wrong', '0', '1.5', '99', '2'];
  let calls = 0;
  assert.equal(await answerLoginPrompt(menu, async text => {
    if (calls > 0) assert.ok(text.includes('Invalid choice'));
    return values[calls++];
  }), 'device_code');
  assert.equal(calls, values.length);
});

test('manual callback input is passed through unchanged', async () => {
  const callback = 'http://localhost:1455/auth/callback?code=test-code&state=test-state';
  assert.equal(await answerLoginPrompt({ type: 'manual_code', message: 'Paste redirect URL' }, async () => callback), callback);
});

test('cancelled, empty, and secret prompts do not request terminal input', async () => {
  const ask = async () => { assert.fail('Must not request terminal input'); };
  await assert.rejects(answerLoginPrompt({ ...menu, signal: AbortSignal.abort() }, ask), { name: 'AbortError' });
  await assert.rejects(answerLoginPrompt({ ...menu, options: [] }, ask), /no login methods/);
  await assert.rejects(answerLoginPrompt({ type: 'secret', message: 'Secret' }, ask), /Secret entry is not supported/);
});
