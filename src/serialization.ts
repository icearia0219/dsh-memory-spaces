/** Model-context serialization helpers with exact UTF-8 accounting. */

/**
 * Serialize JSON without allowing stored content to spell an XML-like opening tag.
 * @param value - JSON-compatible value to serialize.
 * @returns Lossless JSON with every literal less-than sign escaped.
 */
export function stringifyTagSafeJson(value: unknown): string {
  const serialized: unknown = JSON.stringify(value)
  if (typeof serialized !== 'string') {
    throw new TypeError('memory-spaces data is not JSON-serializable')
  }
  return serialized.replaceAll('<', '\\u003c')
}

/**
 * Retain a UTF-8 prefix without splitting a Unicode code point.
 * @param value - source text.
 * @param maxBytes - inclusive UTF-8 byte cap.
 * @returns a prefix whose encoded size is at most the cap.
 */
export function retainUtf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let retained = ''
  let bytes = 0
  for (const codePoint of value) {
    const width = Buffer.byteLength(codePoint, 'utf8')
    if (bytes + width > maxBytes) break
    retained += codePoint
    bytes += width
  }
  return retained
}
