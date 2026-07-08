// SteamSorry — background service worker.
//
// Two runtime paths, selected at boot by env detection (see lib/env.js):
//
//   Browser (Chrome / Firefox, !isSteamClient):
//     Maintains a single dynamic declarativeNetRequest rule that, for
//     steampowered.com requests carrying the `steamsorry=1` marker, sends
//     all steampowered cookies except the auth cookie `steamLoginSecure`
//     in the `Cookie` request header (or removes the header if none
//     remain). The rule matches main_frame AND xmlhttprequest so the
//     marker semantics ("this request is unauthenticated") are
//     resource-type-agnostic. The cookie jar itself is never modified,
//     so navigating away from the marker page automatically returns to
//     normal cookies.
//
//   Steam desktop client (CEF, isSteamClient):
//     DNR `modifyHeaders` is silently dropped in Steam CEF, so the same
//     effect is achieved by in-place invalidating the auth cookie
//     `steamLoginSecure` in the jar before the marker
//     navigation, then restoring the real value on `pagehide` of the marker
//     page. The content script coordinates the invalidate-before-navigate /
//     restore-on-pagehide handshake via runtime messages.

import browser from 'webextension-polyfill';
import { isSteamClient } from './lib/env.js';

const IS_STEAM = isSteamClient();
const DYNAMIC_RULE_ID = 2;
const STEAM_LOGIN_COOKIE = 'steamLoginSecure';
const AGE_GATE_EXPIRES_SECONDS = 10 * 365 * 24 * 3600;
const AGE_GATE_COOKIES = [
  { name: 'wants_mature_content', value: '1',               path: '/app/'    },
  { name: 'wants_mature_content', value: '1',               path: '/bundle/' },
  { name: 'lastagecheckage',      value: '1-January-1970',  path: '/'        },
  { name: 'birthtime',            value: '1',               path: '/'        },
];

function isSteampoweredDomain(domain) {
  if (!domain) return false;
  return domain === 'steampowered.com' || domain.endsWith('.steampowered.com');
}

function cookieUrl(c) {
  const d = (c.domain || '').replace(/^\./, '');
  return 'https://' + d + (c.path || '/');
}

function setCookieParams(c, value) {
  return {
    url: cookieUrl(c),
    name: c.name,
    value,
    domain: c.hostOnly ? undefined : c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite || 'lax',
    expirationDate: c.expirationDate,
  };
}


async function applyAgeGateCookies() {
  const expires = Math.floor(Date.now() / 1000) + AGE_GATE_EXPIRES_SECONDS;
  let ok = 0;
  let fail = 0;
  for (const c of AGE_GATE_COOKIES) {
    try {
      await browser.cookies.set({
        url: 'https://steampowered.com' + c.path,
        name: c.name,
        value: c.value,
        domain: '.steampowered.com',
        path: c.path,
        secure: true,
        sameSite: 'lax',
        expirationDate: expires,
      });
      ok++;
    } catch (e) {
      fail++;
    }
  }
  console.log(`[steamsorry-worker]: age-gate cookies set (ok=${ok} fail=${fail})`);
}

// =====================================================================
// Browser path — DNR cookie-header rewrite.
// =====================================================================

function headerCookieValue(cookies) {
  const parts = [];
  for (const c of cookies) {
    if (!c || !c.name) continue;
    if (c.name === STEAM_LOGIN_COOKIE) continue;
    if (!isSteampoweredDomain(c.domain)) continue;
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

function buildRule(value) {
  const header = value.length > 0
    ? { header: 'cookie', operation: 'set', value }
    : { header: 'cookie', operation: 'remove' };
  return {
    id: DYNAMIC_RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [header] },
    condition: {
      urlFilter: 'steamsorry=1',
      requestDomains: ['steampowered.com'],
      resourceTypes: ['main_frame', 'xmlhttprequest'],
    },
  };
}

async function rebuild(reason) {
  let cookies = [];
  try {
    cookies = await browser.cookies.getAll({});
  } catch (e) {
    cookies = [];
  }
  const value = headerCookieValue(cookies);
  const rule = buildRule(value);
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DYNAMIC_RULE_ID],
      addRules: [rule],
    });
    console.log(`[steamsorry-worker]: rebuilt dynamic rule (${reason}, bypass=${STEAM_LOGIN_COOKIE}, headerLen=${value.length})`);
  } catch (e) {
    console.error(`[steamsorry-worker]: updateDynamicRules failed: ${String(e)} (headerLen=${value.length})`);
  }
}

function onCookieChange(info) {
  const c = info && info.cookie;
  if (!c || !c.name) return;
  // Browser: rebuild the DNR rule when any steampowered cookie changes.
  if (!isSteampoweredDomain(c.domain)) return;
  if(!IS_STEAM) {
    void rebuild('cookies.onChanged');
  }
}

// =====================================================================
// Steam path — replace login cookie in place
// =====================================================================
let _cookiesBckp = null;

async function setSteamLoginSecure(c, value) {
  await browser.cookies.set(setCookieParams(c, value));
}

async function handleInvalidate() {
  try {
    const all = await browser.cookies.getAll({});
    const c = all.find((x) => x.name === STEAM_LOGIN_COOKIE && isSteampoweredDomain(x.domain));
    if (!c) {
      console.log('[steamsorry-worker]: invalidate — steamLoginSecure not found');
      return { ok: false, reason: 'not found' };
    }
    _cookiesBckp = c;

    await setSteamLoginSecure(c, "_");
    return { ok: true };
  } catch (e) {
    console.log('[steamsorry-worker]: invalidate error: ' + String(e));
    return { ok: false, error: String(e) };
  }
}

async function handleRestore() {
  if (!_cookiesBckp) {
    console.log('[steamsorry-worker]: restore — nothing to restore');
    return { ok: true };
  }
  try {
    await setSteamLoginSecure(_cookiesBckp, _cookiesBckp.value);
    _cookiesBckp = null;
    console.log('[steamsorry-worker]: restore OK — real value restored');
    return { ok: true };
  } catch (e) {
    console.log('[steamsorry-worker]: restore error: ' + String(e));
    return { ok: false, error: String(e) };
  }
}

// =====================================================================
// Listener installation + boot.
// =====================================================================

function installListeners() {
  browser.runtime.onInstalled.addListener(() => {
    void applyAgeGateCookies();
    if (!IS_STEAM) void rebuild('onInstalled');
  });
  if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      void applyAgeGateCookies();
      if (!IS_STEAM) void rebuild('onStartup');
    });
  }
  if (browser.cookies.onChanged) {
    browser.cookies.onChanged.addListener(onCookieChange);
  }
  // ss:invalidate-cookie / ss:restore-cookie are only sent by the Steam
  // branch of the content script, but the handler is harmless when idle.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'ss:invalidate-cookie') return handleInvalidate();
    if (msg && msg.type === 'ss:restore-cookie') return handleRestore();
  });
}

installListeners();

if (IS_STEAM) {
  console.log('[steamsorry-worker]: Steam CEF env');
  void applyAgeGateCookies();
} else {
  console.log('[steamsorry-worker]: browser env');
  void rebuild('startup');
  void applyAgeGateCookies();
}
