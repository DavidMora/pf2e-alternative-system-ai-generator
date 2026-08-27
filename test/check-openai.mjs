import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'scripts');

let settings = {};
let stored = {};
globalThis.game = {
  settings: {
    get: (_m, k) => (k in settings ? settings[k] : stored[k]),
    set: async (_m, k, v) => { stored[k] = v; },
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
};
// The retry path warns and the usage report informs, so both need somewhere to
// go. Captured rather than swallowed, because what the GM is told is the thing
// under test for a module that spends their money.
export const said = [];
globalThis.ui = {
  notifications: {
    info: (m) => said.push(`info:${m}`),
    warn: (m) => said.push(`warn:${m}`),
    error: (m) => said.push(`error:${m}`),
  },
};

const { requestStructured, activeModel, estimateCost, spendToDate } =
  await import(`file://${base}/ai/openai.js`);

let failed = 0;
const check = (l, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  if (!ok) { failed = 1; console.error(`FAIL ${l}\n  got ${JSON.stringify(a)}\n  exp ${JSON.stringify(e)}`); }
  else console.log(`ok  ${l}`);
};
const reject = async (l, fn, fragment) => {
  try { await fn(); failed = 1; console.error(`FAIL ${l}: expected a throw`); }
  catch (e) {
    if (e.message.includes(fragment)) console.log(`ok  ${l}`);
    else { failed = 1; console.error(`FAIL ${l}: message was "${e.message}"`); }
  }
};

// Missing key must fail before any network call.
settings = { openaiApiKey: '   ', openaiModel: 'gpt-5.6-terra' };
globalThis.fetch = () => { throw new Error('fetch should not run'); };
await reject('missing key throws early', () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' }), 'PFAI.Errors.NoApiKey');

// Model override wins over the dropdown.
settings = { openaiApiKey: 'sk-test', openaiModel: 'gpt-5.6-terra', openaiModelOverride: ' gpt-5.6-sol ' };
check('override wins', activeModel(), 'gpt-5.6-sol');
settings.openaiModelOverride = '';
check('dropdown used when no override', activeModel(), 'gpt-5.6-terra');

// Happy path: inspect the outgoing request.
let captured;
settings = { openaiApiKey: 'sk-test', openaiModel: 'gpt-5.6-terra', openaiBaseUrl: 'https://api.openai.com/v1/', openaiTemperature: null };
globalThis.fetch = async (url, init) => {
  captured = { url, init: { ...init, body: JSON.parse(init.body) } };
  return { ok: true, json: async () => ({ choices: [{ message: { content: '{"name":"Run"}' } }] }) };
};
const out = await requestStructured({ schemaName: 'pf2e_chase', schema: { type: 'object' }, system: 'sys', user: 'usr' });
check('parsed result', out, { name: 'Run' });
check('trailing slash stripped from base url', captured.url, 'https://api.openai.com/v1/chat/completions');
check('auth header', captured.init.headers.Authorization, 'Bearer sk-test');
check('model sent', captured.init.body.model, 'gpt-5.6-terra');
check('strict json_schema', captured.init.body.response_format, { type: 'json_schema', json_schema: { name: 'pf2e_chase', strict: true, schema: { type: 'object' } } });
check('temperature omitted when unset', 'temperature' in captured.init.body, false);
check('messages', captured.init.body.messages.map((m) => m.role), ['system', 'user']);

// Temperature is a free-text String setting. Blank / garbage must be omitted
// rather than sent, and a real value must be parsed and clamped.
for (const [label, raw, expected] of [
  ['blank string omitted', '', undefined],
  ['whitespace omitted', '   ', undefined],
  ['garbage omitted', 'hot', undefined],
  ['numeric string parsed', '0.8', 0.8],
  ['integer string parsed', '1', 1],
  ['zero is honoured', '0', 0],
  ['above range clamped', '9', 2],
  ['below range clamped', '-3', 0],
]) {
  settings.openaiTemperature = raw;
  await requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' });
  check(`temperature: ${label}`, captured.init.body.temperature, expected);
}

// Error paths.
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid key' } }) });
await reject('api error surfaces status and message', () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' }), 'Invalid key');

globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { refusal: 'nope' } }] }) });
await reject('refusal surfaced', () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' }), 'PFAI.Errors.Refusal');

globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
await reject('bad json surfaced', () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' }), 'PFAI.Errors.BadJson');

globalThis.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
await reject('abort propagates unchanged', () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' }), 'aborted');

/* ------------------------------------------------- retrying, and not retrying */

/*
 * A call the GM has already paid for should not be lost to a blip, but asking
 * again after a refusal or a bad key just spends more money to fail the same
 * way. These assert both halves, and count the calls, because "it retried"
 * and "it retried the right number of times" are different claims.
 */
const ask = () => requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b' });
settings = { openaiApiKey: 'sk-test', openaiModel: 'gpt-5.6-terra' };

let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return calls === 1
    ? { ok: false, status: 503, json: async () => ({ error: { message: 'overloaded' } }) }
    : { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
};
said.length = 0;
check('a transient failure is retried and succeeds',
  await ask().catch((e) => `threw: ${e.message}`), { ok: true });
check('and it took exactly two calls', calls, 2);
check('and the GM was told it was retrying', said.some((m) => m.includes('Retrying')), true);

calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { ok: false, status: 503, json: async () => ({ error: { message: 'overloaded' } }) };
};
await reject('a failure that persists still fails', ask, 'PFAI.Errors.Api');
check('after one retry, not endlessly', calls, 2);

for (const [label, status] of [['a bad key', 401], ['a rejected schema', 400]]) {
  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status, json: async () => ({ error: { message: 'no' } }) };
  };
  await reject(`${label} fails at once`, ask, 'PFAI.Errors.Api');
  check(`${label} is not retried, because it would fail the same way`, calls, 1);
}

calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { ok: true, json: async () => ({ choices: [{ message: { refusal: 'nope' } }] }) };
};
await reject('a refusal fails at once', ask, 'PFAI.Errors.Refusal');
check('a refusal is the model considered answer, so it is not retried', calls, 1);

calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return calls === 1
    ? { ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }
    : { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
};
check('an unparseable answer is retried',
  await ask().catch((e) => `threw: ${e.message}`), { ok: true });

calls = 0;
globalThis.fetch = async () => { calls += 1; const e = new Error('cancelled'); e.name = 'AbortError'; throw e; };
await reject('a GM who cancels is obeyed', ask, 'cancelled');
check('and it is not retried behind their back', calls, 1);

/* ------------------------------------------------------------------ timeout */

/*
 * The timeout is composed with the caller's signal rather than replacing it, so
 * cancelling still works. The two must stay distinguishable: one is the GM's
 * decision and stops, the other is a failure and retries.
 */
settings = { openaiApiKey: 'sk-test', openaiModel: 'gpt-5.6-terra', openaiRequestTimeout: '0.3' };
calls = 0;
globalThis.fetch = async (_url, init) => {
  calls += 1;
  // Never settles on its own; only the timeout can end it.
  return new Promise((_resolve, rejectFetch) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; rejectFetch(e);
    });
  });
};
/*
 * Timed, because "it eventually gave up" and "it waited as long as the GM asked"
 * are different claims, and a hardcoded delay satisfies the first while ignoring
 * the setting entirely. Two attempts at 0.3s, so comfortably over 300ms.
 */
const startedAt = Date.now();
await reject('a hung request gives up rather than waiting for ever', ask, 'PFAI.Errors.Timeout');
const elapsed = Date.now() - startedAt;
check('and is retried once, since a hang is usually transient', calls, 2);
check('the configured wait is honoured rather than some fixed delay',
  elapsed >= 500, true);

// The caller's own signal must still cut it short, and must not be retried.
settings.openaiRequestTimeout = '30';
calls = 0;
const controller = new AbortController();
const inFlight = requestStructured({ schemaName: 's', schema: {}, system: 'a', user: 'b', signal: controller.signal });
controller.abort();
await reject('a cancel from the dialog still stops it', () => inFlight, 'aborted');
check('and that is not retried either', calls, 1);

/* --------------------------------------------------------------- what it cost */

check('a known model is priced from published rates',
  Number(estimateCost('gpt-5.6-terra', { prompt_tokens: 1_000_000, completion_tokens: 0 }).toFixed(4)), 0.25);
check('output is priced separately from input',
  Number(estimateCost('gpt-5.6-terra', { prompt_tokens: 0, completion_tokens: 1_000_000 }).toFixed(4)), 2);
check('a model with no published price reports no figure rather than inventing one',
  estimateCost('some-local-llama', { prompt_tokens: 100, completion_tokens: 100 }), null);
check('and neither does a response that reported no usage',
  estimateCost('gpt-5.6-terra', undefined), null);

stored = {};
settings = { openaiApiKey: 'sk-test', openaiModel: 'gpt-5.6-terra' };
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  }),
});
said.length = 0;
await ask();
check('the GM is told what the call used', said.some((m) => m.includes('PFAI.Usage.Reported')), true);
check('the request is counted', spendToDate().requests, 1);
check('with its tokens', [spendToDate().inputTokens, spendToDate().outputTokens], [1000, 500]);
await ask();
check('and a second call accumulates rather than replacing',
  [spendToDate().requests, spendToDate().inputTokens], [2, 2000]);
check('the running cost adds up',
  Number(spendToDate().cost.toFixed(4)), Number(((1000 * 0.25 + 500 * 2) / 1e6 * 2).toFixed(4)));

stored = {};
settings.openaiModelOverride = 'some-local-llama';
said.length = 0;
await ask();
check('an unpriced model still reports its tokens',
  said.some((m) => m.includes('PFAI.Usage.TokensOnly')), true);
check('and counts them', spendToDate().inputTokens, 1000);
check('without adding a made-up cost', spendToDate().cost, 0);
settings.openaiModelOverride = '';

stored = {};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) });
said.length = 0;
await ask();
check('a response with no usage block is not counted as a request', spendToDate().requests, 0);
check('and says nothing about cost', said.some((m) => m.includes('PFAI.Usage')), false);


process.exit(failed);
