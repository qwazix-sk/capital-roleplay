// Cloudflare Pages Function — FiveM Live Server Stats
//
// Primary source: the FXServer's own HTTP endpoints (info.json + dynamic.json)
// on the game server. This is the same data txAdmin reads to render its Discord
// status embed, so it's always in sync with what players actually see in-game.
//
// Fallback: the public CFX listing API. CFX caches the last-known Data object
// for several minutes after a server goes offline and never sets a reliable
// `offline` flag, so we use `lastSeen` age as a proxy for liveness.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const UA          = "CapitalRoleplay-Stats/1.0";
const FX_TIMEOUT  = 4000;  // ms — direct FXServer probe
// CFX is a fallback only. Heartbeats from this server to the master list are
// unreliable (often 5+ min stale even when the server is fully online), so
// we use a generous window — the FX probe is the real liveness signal; CFX
// just needs to confirm the server existed recently.
const CFX_STALE_S = 900;

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Direct FXServer probe — the source of truth.
//
// The two endpoints (info.json + dynamic.json) rate-limit independently and
// either one will sometimes time out under load, so we treat *either* a
// successful response as proof the server is up. dynamic.json is the
// preferred source because it carries both clients and sv_maxclients in one
// shot; info.json is only consulted when dynamic.json fails (it gives us
// sv_maxClients but not the live player count).
async function fetchFxserver(host) {
  const base = `http://${host}`;
  const [dynR, infoR] = await Promise.allSettled([
    fetchJson(`${base}/dynamic.json`, FX_TIMEOUT),
    fetchJson(`${base}/info.json`,    FX_TIMEOUT),
  ]);

  if (dynR.status !== "fulfilled" && infoR.status !== "fulfilled") return null;

  const dyn  = dynR.status  === "fulfilled" ? (dynR.value  || {}) : {};
  const info = infoR.status === "fulfilled" ? (infoR.value || {}) : {};

  // maxPlayers: dynamic.json has it as a number; info.json has it as a string under vars.
  let maxPlayers = 0;
  if (typeof dyn.sv_maxclients === "number") {
    maxPlayers = dyn.sv_maxclients;
  } else if (info.vars && info.vars.sv_maxClients) {
    maxPlayers = parseInt(info.vars.sv_maxClients, 10) || 0;
  }

  // players: only available from dynamic.json. If only info.json responded,
  // we know the server is up but not the live count — show 0 rather than
  // pretending we have a number.
  const players = typeof dyn.clients === "number" ? dyn.clients : 0;

  return { players, maxPlayers, online: true, lastSeenAgeS: null };
}

// CFX listing fallback. Returns null on total failure; caller will then return
// an offline-default response.
async function fetchCfx(code) {
  let d;
  try {
    d = await fetchJson(`https://servers-frontend.fivem.net/api/servers/single/${code}`, 5000);
  } catch {
    return null;
  }
  if (!d?.Data) return null;

  const D          = d.Data;
  let players      = typeof D.clients       === "number" ? D.clients       : 0;
  const maxPlayers = typeof D.sv_maxclients === "number" ? D.sv_maxclients : 0;

  const lastSeenMs   = D.lastSeen ? Date.parse(D.lastSeen) : NaN;
  const lastSeenAgeS = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.round((Date.now() - lastSeenMs) / 1000))
    : null;

  const explicitOffline = D.offline === true;
  const stale           = lastSeenAgeS === null || lastSeenAgeS > CFX_STALE_S;
  const online          = !explicitOffline && !stale;

  if (!online) players = 0;

  return { players, maxPlayers, online, lastSeenAgeS };
}

export async function onRequest({ env }) {
  const host = (env.FIVEM_SERVER_HOST || "45.8.187.43:30120").trim();
  const code = (env.FIVEM_CFX_CODE    || "mx89xv"           ).trim();

  let data = await fetchFxserver(host);
  if (!data) data = await fetchCfx(code);
  if (!data) {
    data = { players: 0, maxPlayers: 0, online: false, lastSeenAgeS: null };
  }

  // Connect URL goes through CFX — the player's browser hits cfx.re/join/<code>
  // which resolves the actual server address on their end. The server IP is
  // never returned to the website, so it never appears in HTML, the Network
  // tab, or right-click "copy link".
  data.connectUrl = `https://cfx.re/join/${code}`;

  return new Response(JSON.stringify(data), {
    headers: {
      ...CORS,
      "Cache-Control": "public, max-age=10, s-maxage=10",
    },
  });
}
