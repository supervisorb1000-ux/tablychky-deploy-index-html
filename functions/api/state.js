const KV_KEY = "tablychky-state";
const EMPTY = { items: [], settings: null, settingsUpdatedAt: 0 };

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" }
  });
}

function mergeItems(current, incoming) {
  var byId = {};
  (current || []).forEach(function (i) { byId[i.id] = i; });
  (incoming || []).forEach(function (i) {
    var ex = byId[i.id];
    if (!ex || (i.updatedAt || 0) >= (ex.updatedAt || 0)) byId[i.id] = i;
  });
  return Object.keys(byId).map(function (k) { return byId[k]; });
}

export async function onRequestGet({ env }) {
  var raw = await env.STATE.get(KV_KEY);
  var data = raw ? JSON.parse(raw) : EMPTY;
  return json(data);
}

export async function onRequestPost({ request, env }) {
  var incoming = await request.json();
  var raw = await env.STATE.get(KV_KEY);
  var current = raw ? JSON.parse(raw) : EMPTY;

  var merged = {
    items: mergeItems(current.items, incoming.items),
    settings: (incoming.settingsUpdatedAt || 0) >= (current.settingsUpdatedAt || 0)
      ? incoming.settings
      : current.settings,
    settingsUpdatedAt: Math.max(incoming.settingsUpdatedAt || 0, current.settingsUpdatedAt || 0)
  };

  await env.STATE.put(KV_KEY, JSON.stringify(merged));
  return json(merged);
}
