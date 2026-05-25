const MAX_REGEX_SOURCE_LENGTH = 256;
const MAX_REGEX_CACHE_SIZE = 256;
const VALID_FLAGS_RE = /^[dgimsuvy]*$/;
const regexCache = new Map();

function hasUnsafeNestedQuantifier(source) {
  return /\([^)]*[+*][^)]*\)\s*[+*{]/.test(source) || /\([^)]*\{\d+,?\d*\}[^)]*\)\s*[+*{]/.test(source);
}

function remember(key, value) {
  if (regexCache.has(key)) regexCache.delete(key);
  regexCache.set(key, value);
  if (regexCache.size > MAX_REGEX_CACHE_SIZE) {
    regexCache.delete(regexCache.keys().next().value);
  }
}

function getCachedRegex(key) {
  if (!regexCache.has(key)) return null;
  const cached = regexCache.get(key);
  regexCache.delete(key);
  regexCache.set(key, cached);
  return cached;
}

export function getPooledRegex(source, flags = '') {
  const pattern = String(source || '');
  const normalizedFlags = String(flags || '');
  if (!pattern || pattern.length > MAX_REGEX_SOURCE_LENGTH) return null;
  if (!VALID_FLAGS_RE.test(normalizedFlags)) return null;
  if (hasUnsafeNestedQuantifier(pattern)) return null;

  const key = `${normalizedFlags}/${pattern}`;
  const cached = getCachedRegex(key);
  if (cached) return cached;

  try {
    const regex = new RegExp(pattern, normalizedFlags);
    remember(key, regex);
    return regex;
  } catch {
    return null;
  }
}

export function execPooledRegex(source, input, flags = '') {
  const regex = getPooledRegex(source, flags);
  if (!regex) return null;
  regex.lastIndex = 0;
  return regex.exec(String(input || ''));
}

export function testPooledRegex(source, input, flags = '') {
  const regex = getPooledRegex(source, flags);
  if (!regex) return false;
  regex.lastIndex = 0;
  return regex.test(String(input || ''));
}

export function clearRegexPool() {
  regexCache.clear();
}