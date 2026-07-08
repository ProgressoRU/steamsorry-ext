import browser from 'webextension-polyfill';
import { urlWithCcMarker } from './lib/url'
import { isSteamClient } from './lib/env.js';

(function () {
  'use strict';
  if (window.__steamsorryContentInit) return;
  window.__steamsorryContentInit = true;

  const APP_PATH_RE = /^\/(?:[a-z]+\/)?app\//;
  const BUNDLE_PATH_RE = /^\/(?:[a-z]+\/)?(?:bundle|sub)\//;
  const SEARCH_PATH_RE = /^\/(?:[a-z]+\/)?search\//;
  const MARKER = 'steamsorry=1';
  const DEFAULT_CC = 'us';
  const PAGE_URL = browser.runtime.getURL('src/steamsorry-page.js');
  const IS_STEAM = isSteamClient();
  const DEFAULTS = { cc: DEFAULT_CC, searchRewrite: true };

  function injectPageScript() {
    if (!PAGE_URL) return;
    if (document.querySelector('script[data-steamsorry="1"]')) return;
    const s = document.createElement('script');
    s.src = PAGE_URL;
    s.async = false;
    s.setAttribute('data-steamsorry', '1');
    console.log(`[steamsorry-cs]: script injected`);
    (document.head || document.documentElement).appendChild(s);
  }

  function applyConfig(opts) {
    const cc = (opts && opts.cc) ? String(opts.cc).toLowerCase() : DEFAULT_CC;
    const sr = opts && opts.searchRewrite === false ? '0' : '1';
    const root = document.documentElement;
    if (!root) return;
    root.dataset.ssCc = cc;
    root.dataset.ssSearchRewrite = sr;
  }

  async function requestUnauthReload(targetCc) {
    const url = urlWithCcMarker(location.href, targetCc);
    if (IS_STEAM) {
      console.log(`[steamsorry-cs]: sending invalidate-cookie before navigate to ${url}`);
      try {
        const res = await browser.runtime.sendMessage({ type: 'ss:invalidate-cookie' });
        console.log(`[steamsorry-cs]: invalidate result: ${JSON.stringify(res)}`);
      } catch (e) {
        console.log(`[steamsorry-cs]: invalidate failed: ${String(e)}`);
      }
    }
    location.replace(url);
  }

  function rewriteBundleLinks(cc) {
    if (!BUNDLE_PATH_RE) return;
    const links = document.querySelectorAll('a[href]');
    for (const a of links) {
      let href;
      try { href = a.getAttribute('href'); } catch (e) { continue; }
      if (!href) continue;
      let u;
      try { u = new URL(href, location.href); } catch (e) { continue; }
      if (!BUNDLE_PATH_RE.test(u.pathname) && !APP_PATH_RE.test(u.pathname)) continue;
      if (u.searchParams.get('steamsorry') === '1') continue;
      a.setAttribute('href', urlWithCcMarker(u.href, cc));
    }
  }

  function injectUnauthBanner(targetCc) {
    if (document.getElementById('steamsorry-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'steamsorry-banner';
    bar.textContent = 'Просмотр через ' + targetCc.toUpperCase() + ' - Ой, извините!';
    bar.style.cssText = [
      'position:sticky', 'bottom:-1px', 'left:0', 'right:0', 'z-index:999999',
      'padding:6px 12px', 'background:#1b2838', 'color:#66c0f4',
      'border-top:1px solid #66c0f4', 'font:13px/1.4 Arial,sans-serif',
      'text-align:center', 'pointer-events:none'
    ].join(';');
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(bar);
    });
  }

  // ---- boot ----
  function apply(opts) {
    applyConfig(opts);
    injectPageScript();

    const cc = (opts && opts.cc) ? String(opts.cc).toLowerCase() : DEFAULT_CC;
    const hasMarker = location.search.indexOf(MARKER) !== -1;
    const isSearch = opts && opts.searchRewrite === false
      ? false
      : SEARCH_PATH_RE.test(location.pathname);
    const isApp = APP_PATH_RE.test(location.pathname);
    const isBundle = BUNDLE_PATH_RE.test(location.pathname);

    // already has marker, should show banner
    if (hasMarker) {
      if (isSearch || isApp || isBundle) injectUnauthBanner(cc);
      if (isApp) {
        document.addEventListener('DOMContentLoaded', () => rewriteBundleLinks(cc));
      }
      return;
    }

    if (isSearch || isBundle) {
      requestUnauthReload(cc);
      return;
    }

    document.addEventListener('DOMContentLoaded', () => {
      if (isApp && document.getElementById('error_box')) {
        console.log('[steamsorry-cs] - error page detected, requesting reload');
        requestUnauthReload(cc);
        return;
      }
      if (isApp || isBundle) rewriteBundleLinks(cc);
      console.log('[steamsorry-cs] - requesting restore-cookie');
      browser.runtime.sendMessage({ type: 'ss:restore-cookie' })
        .then(r => console.log(`[steamsorry-cs] - restore result: ${JSON.stringify(r)}`))
        .catch(e => console.log(`[steamsorry-cs] - restore failed: ${String(e)}`));
    });
  }

  browser.storage.sync.get(DEFAULTS).then(apply);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'sync') return;
    browser.storage.sync.get(DEFAULTS).then(apply);
  });
})();