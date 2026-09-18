const KV_KEY = "tablychky-state";
const EMPTY = { items: [], settings: null, settingsUpdatedAt: 0 };
const MAX_FILE = 5 * 1024 * 1024;
const MAX_STATE = 2 * 1024 * 1024;
const FILE_ID = /^[a-z0-9]{6,40}$/i;
const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function checkAuth(request, env) {
  if (!env.APP_TOKEN) return true;
  return request.headers.get("X-App-Token") === env.APP_TOKEN;
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

// Drop items deleted long ago and free up the files they held, so the
// state blob and KV storage don't grow forever.
async function sweepTombstones(items, env) {
  var cutoff = Date.now() - TOMBSTONE_MS;
  var kept = [];
  var removals = [];
  items.forEach(function (i) {
    if (i.deleted && (i.updatedAt || 0) < cutoff) {
      (i.files || []).forEach(function (f) {
        if (f && f.id) removals.push(env.STATE.delete("file:" + f.id));
      });
    } else {
      kept.push(i);
    }
  });
  if (removals.length) await Promise.all(removals);
  return kept;
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
  var fileId = new URL(request.url).searchParams.get("file");
  if (fileId) {
    if (!FILE_ID.test(fileId)) return json({ error: "bad id" }, 400);
    var buf = await env.STATE.get("file:" + fileId, "arrayBuffer");
    if (!buf) return json({ error: "not found" }, 404);
    return new Response(buf, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }
    });
  }
  var raw = await env.STATE.get(KV_KEY);
  return json(raw ? JSON.parse(raw) : EMPTY);
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return json({ error: "unauthorized" }, 401);
  var fileId = new URL(request.url).searchParams.get("file");
  if (fileId) {
    if (!FILE_ID.test(fileId)) return json({ error: "bad id" }, 400);
    var body = await request.arrayBuffer();
    if (body.byteLength > MAX_FILE) return json({ error: "too large" }, 413);
    await env.STATE.put("file:" + fileId, body);
    return json({ ok: true });
  }

  var rawBody = await request.text();
  if (rawBody.length > MAX_STATE) return json({ error: "too large" }, 413);
  var incoming = JSON.parse(rawBody);
  var raw = await env.STATE.get(KV_KEY);
  var current = raw ? JSON.parse(raw) : EMPTY;

  var mergedItems = mergeItems(current.items, incoming.items);
  mergedItems = await sweepTombstones(mergedItems, env);

  var merged = {
    items: mergedItems,
    settings: (incoming.settingsUpdatedAt || 0) >= (current.settingsUpdatedAt || 0)
      ? incoming.settings
      : current.settings,
    settingsUpdatedAt: Math.max(incoming.settingsUpdatedAt || 0, current.settingsUpdatedAt || 0)
  };

  await env.STATE.put(KV_KEY, JSON.stringify(merged));
  return json(merged);
}
