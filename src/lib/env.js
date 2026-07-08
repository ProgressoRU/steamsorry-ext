// Shared env detection for the webextension's two runtime branches:
//   - real browsers (Chrome / Firefox) use the DNR cookie-header rewrite path
//   - Steam desktop client (CEF) uses the cookie-shield in-place invalidation
//     path because Steam's CEF silently drops DNR modifyHeaders actions
//
// Detection is UA-based. Verified Steam UA:
//   Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Valve Steam Client Safari/537.36
// Chrome and Firefox UAs do not contain "Steam", so /steam/i is a safe marker.

export function isSteamClient() {
  try {
    return /steam/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}
