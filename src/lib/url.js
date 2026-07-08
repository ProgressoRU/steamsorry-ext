export function urlWithCcMarker(url, cc) {
  const u = new URL(url, location.href);
  u.searchParams.set('cc', cc);
  u.searchParams.set('steamsorry', '1');
  return u.toString();
}