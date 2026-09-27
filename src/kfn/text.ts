const utf8 = new TextDecoder('utf-8', { fatal: true })
const cp1252 = new TextDecoder('windows-1252')

/**
 * Decode text stored in a KFN file. KaraFun writes UTF-8, but older files
 * may use the Windows ANSI code page, so fall back to windows-1252.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string
  try {
    text = utf8.decode(bytes)
  } catch {
    text = cp1252.decode(bytes)
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Decode multi-line text one line at a time. Some KaraFun files mix encodings
 * (UTF-8 lyrics next to a windows-1252 file name), and decoding the whole file
 * at once would garble every "ä" as "Ã¤".
 */
export function decodeTextByLine(bytes: Uint8Array): string {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      lines.push(decodeText(bytes.subarray(start, i)))
      start = i + 1
    }
  }
  return lines.join('\n')
}
