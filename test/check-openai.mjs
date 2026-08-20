import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'scripts');

let settings = {};
globalThis.game = {
  settings: { get: (_m, k) => settings[k] },
  i18n: { localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
};

const { requestStructured, activeModel } = await import(`file://${base}/ai/openai.js`);

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

process.exit(failed);
