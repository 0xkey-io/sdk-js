// Release-data parser only. Ranges are byte offsets in the original UTF-8 body.
export function fail(code) {
  throw new Error(`PAY_NPM_${code}`);
}

export function strictJson(bytes, limit = 2 * 1024 * 1024) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limit)
    fail("JSON_SIZE");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("JSON_UTF8");
  }
  let offset = 0;
  let tokens = 0;
  const ranges = new WeakMap();
  const whitespace = () => {
    while ([9, 10, 13, 32].includes(bytes[offset])) offset++;
  };
  function string() {
    const start = offset++;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      if (offset - start > 1024 * 1024) fail("JSON_TOKEN_SIZE");
      if (byte === 92) {
        offset++;
        continue;
      }
      if (byte !== 34) continue;
      let value;
      try {
        value = JSON.parse(bytes.subarray(start, offset).toString("utf8"));
      } catch {
        fail("JSON_SYNTAX");
      }
      if (!value.isWellFormed()) fail("JSON_UNICODE");
      return value;
    }
    fail("JSON_SYNTAX");
  }
  function value(depth) {
    whitespace();
    if (depth > 64 || ++tokens > 100000) fail("JSON_COMPLEXITY");
    const start = offset;
    const first = bytes[offset];
    if (first === 34) return string();
    if (first === 123 || first === 91) {
      offset++;
      const object = first === 123;
      const result = object ? {} : [];
      const keys = new Set();
      const close = object ? 125 : 93;
      whitespace();
      if (bytes[offset] !== close)
        while (true) {
          if (object) {
            if (bytes[offset] !== 34) fail("JSON_SYNTAX");
            const key = string();
            if (Buffer.byteLength(key) > 4096) fail("JSON_TOKEN_SIZE");
            if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
            keys.add(key);
            whitespace();
            if (bytes[offset++] !== 58) fail("JSON_SYNTAX");
            Object.defineProperty(result, key, {
              value: value(depth + 1),
              enumerable: true,
              writable: true,
              configurable: true,
            });
          } else result.push(value(depth + 1));
          whitespace();
          if (bytes[offset] === close) break;
          if (bytes[offset++] !== 44) fail("JSON_SYNTAX");
          whitespace();
        }
      offset++;
      ranges.set(result, { start, end: offset });
      return result;
    }
    while (
      offset < bytes.length &&
      ![9, 10, 13, 32, 44, 93, 125].includes(bytes[offset])
    )
      offset++;
    const token = bytes.subarray(start, offset).toString("utf8");
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (
      token.length > 128 ||
      !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)
    )
      fail("JSON_SYNTAX");
    const number = Number(token);
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    )
      fail("JSON_NUMBER");
    return number;
  }
  const parsed = value(0);
  whitespace();
  if (offset !== bytes.length) fail("JSON_SYNTAX");
  return { value: parsed, ranges };
}
