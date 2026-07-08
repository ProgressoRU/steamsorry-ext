// Minimal protobuf codec (varint + wire types 0/1/2/5) for rewriting the
// SearchSuggestions request's `context.country_code`.

function readVarint(buf, st) {
  var r = 0, s = 0, b;
  while (st.i < buf.length) {
    b = buf[st.i]; st.i = st.i + 1;
    r = r | ((b & 0x7f) << s);
    s = s + 7;
    if (!(b & 0x80)) break;
  }
  return r >>> 0;
}

function writeVarint(num) {
  num = num >>> 0;
  var out = [], b;
  while (true) {
    b = num & 0x7f; num = num >>> 7;
    if (num) b = b | 0x80;
    out.push(b);
    if (!num) break;
  }
  return Uint8Array.from(out);
}

function concat(arrs) {
  var n = 0, i; for (i = 0; i < arrs.length; i++) n += arrs[i].length;
  var out = new Uint8Array(n), p = 0;
  for (i = 0; i < arrs.length; i++) { out.set(arrs[i], p); p += arrs[i].length; }
  return out;
}

function decodeMessage(buf) {
  var st = { i: 0 };
  var fields = [];
  while (st.i < buf.length) {
    var t = readVarint(buf, st);
    var f = t >>> 3, w = t & 7, val;
    if (w === 0) { val = readVarint(buf, st); }
    else if (w === 2) { var l = readVarint(buf, st); val = buf.slice(st.i, st.i + l); st.i += l; }
    else if (w === 5) { val = buf.slice(st.i, st.i + 4); st.i += 4; }
    else if (w === 1) { val = buf.slice(st.i, st.i + 8); st.i += 8; }
    else { break; }
    fields.push({ field: f, wire: w, value: val });
  }
  return fields;
}

function encodeFields(fields) {
  var parts = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var tag = writeVarint((f.field << 3) | f.wire);
    var body;
    if (f.wire === 0) body = writeVarint(f.value);
    else if (f.wire === 2) body = concat([writeVarint(f.value.length), f.value]);
    else body = f.value;
    parts.push(concat([tag, body]));
  }
  return concat(parts);
}

function findSub(fields, n) {
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].field === n && fields[i].wire === 2) {
      return decodeMessage(fields[i].value);
    }
  }
  return null;
}

function setStringField(fields, n, value) {
  var bytes = (value instanceof Uint8Array) ? value : new TextEncoder().encode(String(value));
  var replaced = false, out = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.field === n && f.wire === 2) {
      if (!replaced) { out.push({ field: n, wire: 2, value: bytes }); replaced = true; }
    } else out.push(f);
  }
  if (!replaced) out.push({ field: n, wire: 2, value: bytes });
  return out;
}

function bytesToB64(u8) {
  var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64ToBytes(b64) {
  var bin = atob(b64);
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function rewriteCountryInUrl(url, newCc) {
  const u = new URL(url, location.href);
  var b64 = u.searchParams.get('input_protobuf_encoded');
  if (!b64) return null;
  var raw;
  try { raw = b64ToBytes(b64); } catch (e) { return null; }
  var fields = decodeMessage(raw);
  var ctx = findSub(fields, 2);
  if (!ctx) return null;
  var newCtx = setStringField(ctx, 3, newCc);
  var newFields = setStringField(fields, 2, encodeFields(newCtx));
  var newRaw = encodeFields(newFields);
  var newB64 = bytesToB64(newRaw);
  u.searchParams.set('input_protobuf_encoded', newB64);
  return u.toString();
}
