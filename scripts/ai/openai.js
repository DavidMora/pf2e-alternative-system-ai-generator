import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODULE_ID,
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

/**
 * Call the OpenAI chat completions endpoint with a strict JSON schema and
 * return the parsed object.
 *
 * Structured Outputs guarantees the response matches `schema`, so callers get a
 * shape they can trust without defensive parsing. Requests go straight from the
 * GM's browser to the API host, which is why the key is GM-restricted.
 */
export async function requestStructured({ schemaName, schema, system, user, signal }) {
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

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(game.i18n.format('PFAI.Errors.Network', { message: error.message }));
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    throw new Error(
      game.i18n.format('PFAI.Errors.Api', { status: response.status, message: detail }),
    );
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (message?.refusal) {
    throw new Error(game.i18n.format('PFAI.Errors.Refusal', { message: message.refusal }));
  }
  if (!message?.content) throw new Error(game.i18n.localize('PFAI.Errors.EmptyResponse'));

  try {
    return JSON.parse(message.content);
  } catch (error) {
    throw new Error(game.i18n.format('PFAI.Errors.BadJson', { message: error.message }));
  }
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
