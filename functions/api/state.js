const KV_KEY = "tablychky-state";
const EMPTY = { items: [], settings: null, settingsUpdatedAt: 0 };
const MAX_FILE = 5 * 1024 * 1024;
const FILE_ID = /^[a-z0-9]{6,40}$/i;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
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

export async function onRequestGet({ request, env }) {
  var fileId = new URL(request.url).searchParams.get("file");
  if (fileId) {
    if (!FILE_ID.test(fileId)) return json({ error: "bad id" }, 400);
    var buf = await env.STATE.get("file:" + fileId, "arrayBuffer");
    if (!buf) return json({ error: "not found" }, 404);
    return new Response(buf, { headers: { "Content-Type": "application/octet-stream" } });
  }
  var raw = await env.STATE.get(KV_KEY);
  return json(raw ? JSON.parse(raw) : EMPTY);
}

export async function onRequestPost({ request, env }) {
  var fileId = new URL(request.url).searchParams.get("file");
  if (fileId) {
    if (!FILE_ID.test(fileId)) return json({ error: "bad id" }, 400);
    var body = await request.arrayBuffer();
    if (body.byteLength > MAX_FILE) return json({ error: "too large" }, 413);
    await env.STATE.put("file:" + fileId, body);
    return json({ ok: true });
  }

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
