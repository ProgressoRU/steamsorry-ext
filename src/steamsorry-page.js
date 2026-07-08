// Main-world script. Patches window.fetch and XMLHttpRequest.open to:
//  1. rewrite the SearchSuggestions protobuf request's context.country_code
//  2. add cc=<cc>&steamsorry=1 to the /search/results AJAX so the
//     background service worker strips the steamLoginSecure cookie from
//     the outgoing request (via DNR in real browsers, via blocking
//     webRequest.onBeforeSendHeaders in Steam CEF).
// loaded via <script src> from WAR. The build (Bun, format=iife) inlines the
// protobuf codec import into the IIFE, so the deployed script remains a
// single self-contained, CSP-safe file.
import { rewriteCountryInUrl } from './lib/protobuf-cc.js';
import { urlWithCcMarker } from './lib/url.js';

(function () {
  'use strict';
  if (window.__steamsorryPatched) return;
  window.__steamsorryPatched = true;

  const SEARCH_URL_RE = /IStoreQueryService\/SearchSuggestions\/v1\/?/;
  const SEARCH_RESULTS_RE = /\/search\/results\b/;

  function shouldRewriteSearch() {
    const root = document.documentElement;
    if (!root) return null;
    if (root.dataset.ssSearchRewrite !== '1') return null;
    const cc = (root.dataset.ssCc || '').toLowerCase();
    if (!cc || cc.length !== 2) return null;
    return cc;
  }

  // --- fetch patch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input :
              (input && input.url) ? input.url : '';
    const cc = shouldRewriteSearch();
    if (cc && SEARCH_RESULTS_RE.test(url)) {
      const srUrl = urlWithCcMarker(url, cc);
      if (srUrl && srUrl !== url) {
        if (typeof input === 'string') {
          return origFetch.call(this, srUrl, init);
        }
        try {
          const srReq = new Request(srUrl, input);
          return origFetch.call(this, srReq, init);
        } catch (e) {
          return origFetch.call(this, srUrl, init);
        }
      }
    }
    if (cc && SEARCH_URL_RE.test(url)) {
      const newUrl = rewriteCountryInUrl(url, cc);
      if (newUrl) {
        if (typeof input === 'string') {
          return origFetch.call(this, newUrl, init);
        } else {
          // Request object: build a new Request with the new URL.
          try {
            const newReq = new Request(newUrl, input);
            return origFetch.call(this, newReq, init);
          } catch (e) {
            return origFetch.call(this, newUrl, init);
          }
        }
      }
    }
    return origFetch.apply(this, arguments);
  };

  // --- XHR patch (search results AJAX) ---
  // Steam's /search/ filter changes fire XMLHttpRequest GETs to
  // /search/results (rebuilt from internal state, dropping cc). Add cc and
  // the steamsorry marker in open() so the background service worker
  // strips the auth cookie from the outgoing request.
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (typeof url === 'string' && SEARCH_RESULTS_RE.test(url)) {
        const cc = shouldRewriteSearch();
        if (cc) {
          const newUrl = urlWithCcMarker(url, cc);
          if (newUrl && newUrl !== url) {
            arguments[1] = newUrl;
          }
        }
      }
    } catch (e) { }
    return origOpen.apply(this, arguments);
  };
})();
