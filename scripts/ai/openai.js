import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  MODEL_PRICES,
  MODULE_ID,
  RETRY_ATTEMPTS,
  SETTINGS,
} from '../constants.js';

/** The model id actually used for a request: free-text override wins. */
export function activeModel() {
  const override = game.settings.get(MODULE_ID, SETTINGS.modelOverride)?.trim();
  if (override) return override;
  return game.settings.get(MODULE_ID, SETTINGS.model) || DEFAULT_MODEL;
}

export function hasApiKey() {
  return Boolean(game.settings.get(MODULE_ID, SETTINGS.apiKey)?.trim());
}


/** What a GM has spent through this module, in tokens and estimated USD. */
export function spendToDate() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.spend);
  return {
    requests: 0, inputTokens: 0, outputTokens: 0, cost: 0,
    ...(typeof stored === 'object' && stored ? stored : {}),
  };
}

/**
 * Estimated USD for one call.
 *
 * Returns null rather than a number for a model with no published price here —
 * a GM may have pointed the base URL at something else entirely, and a made-up
 * figure is worse than none.
 */
export function estimateCost(model, usage) {
  const price = MODEL_PRICES[model];
  if (!price || !usage) return null;
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  return (input * price.input + output * price.output) / 1_000_000;
}

/**
 * Record what a call used and tell the GM.
 *
 * The whole premise of this module is spending somebody's API credits, so the
 * usage the API already returns is reported rather than discarded.
 */
export async function recordUsage(model, usage) {
  if (!usage) return null;
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  const cost = estimateCost(model, usage);

  const before = spendToDate();
  const after = {
    requests: before.requests + 1,
    inputTokens: before.inputTokens + input,
    outputTokens: before.outputTokens + output,
    cost: before.cost + (cost ?? 0),
  };
  // Client scope, like the key it is spent with: one GM's spending is not a
  // fact about the world, and world settings are readable by every player.
  await game.settings.set(MODULE_ID, SETTINGS.spend, after);

  ui.notifications.info(
    cost === null
      ? game.i18n.format('PFAI.Usage.TokensOnly', { input, output })
      : game.i18n.format('PFAI.Usage.Reported', {
          input,
          output,
          cost: cost.toFixed(4),
          total: after.cost.toFixed(2),
        }),
  );
  return { input, output, cost, total: after.cost };
}

/**
 * Call the OpenAI chat completions endpoint with a strict JSON schema and
 * return the parsed object.
 *
 * Structured Outputs guarantees the response matches `schema`, so callers get a
 * shape they can trust without defensive parsing. Requests go straight from the
 * GM's browser to the API host, which is why the key is GM-restricted.
 *
 * One retry, and only for the failures that are worth retrying: a truncated or
 * malformed answer, or an error the API itself says is transient. The GM has
 * already paid for that call, and losing it to a blip is a bad trade. A refusal,
 * a bad key or a schema the API rejects will fail identically the second time,
 * so those are raised at once.
 */
export async function requestStructured(options) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await attemptStructured(options);
    } catch (error) {
      // A GM who cancelled means it, and a permanent failure will not improve.
      if (error.name === 'AbortError' || !error.pfaiRetryable) throw error;
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        ui.notifications.warn(
          game.i18n.format('PFAI.Errors.Retrying', { message: error.message }),
        );
      }
    }
  }
  throw lastError;
}

/** Statuses the API itself describes as worth trying again. */
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

const retryable = (error) => Object.assign(error, { pfaiRetryable: true });

async function attemptStructured({ schemaName, schema, system, user, signal }) {
  const apiKey = game.settings.get(MODULE_ID, SETTINGS.apiKey)?.trim();
  if (!apiKey) throw new Error(game.i18n.localize('PFAI.Errors.NoApiKey'));

  const baseUrl = (game.settings.get(MODULE_ID, SETTINGS.baseUrl) || DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );

  const body = {
    model: activeModel(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    },
  };

  // Reasoning models reject `temperature`, so only send it when a GM opted in.
  // The setting is a free-text String; anything unparseable means "don't send".
  const temperature = Number.parseFloat(game.settings.get(MODULE_ID, SETTINGS.temperature));
  if (Number.isFinite(temperature)) {
    body.temperature = Math.min(Math.max(temperature, 0), 2);
  }

  /*
   * A hung request used to wait for ever behind the dialog's spinner, since the
   * only way out was a GM noticing and cancelling. The timeout is composed with
   * the caller's signal rather than replacing it, so cancelling still works and
   * the two are told apart afterwards: one is the GM's decision, the other is
   * a failure worth retrying.
   */
  const seconds = Number(game.settings.get(MODULE_ID, SETTINGS.requestTimeout))
    || DEFAULT_TIMEOUT_SECONDS;
  const timer = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timer.abort();
  }, seconds * 1000);
  const onCallerAbort = () => timer.abort();
  signal?.addEventListener('abort', onCallerAbort);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw retryable(new Error(game.i18n.format('PFAI.Errors.Timeout', { seconds })));
    }
    if (error.name === 'AbortError') throw error;
    throw retryable(new Error(game.i18n.format('PFAI.Errors.Network', { message: error.message })));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    const error = new Error(
      game.i18n.format('PFAI.Errors.Api', { status: response.status, message: detail }),
    );
    // A rate limit or a 5xx is worth one more try; a 401 or a 400 is not.
    throw TRANSIENT_STATUS.has(response.status) ? retryable(error) : error;
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  // A refusal is the model's considered answer, so asking again wastes a call.
  if (message?.refusal) {
    throw new Error(game.i18n.format('PFAI.Errors.Refusal', { message: message.refusal }));
  }
  if (!message?.content) {
    throw retryable(new Error(game.i18n.localize('PFAI.Errors.EmptyResponse')));
  }

  let parsed;
  try {
    parsed = JSON.parse(message.content);
  } catch (error) {
    // Structured Outputs makes this rare, and rare usually means transient.
    throw retryable(new Error(game.i18n.format('PFAI.Errors.BadJson', { message: error.message })));
  }

  // The API already told us what this cost; only the module used to throw it away.
  await recordUsage(body.model, data.usage);
  return parsed;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message ?? JSON.stringify(payload);
  } catch {
    try {
      return await response.text();
    } catch {
      return response.statusText;
    }
  }
}
