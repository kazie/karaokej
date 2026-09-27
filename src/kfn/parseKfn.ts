import { ecb } from '@noble/ciphers/aes.js'
import { decodeText } from './text'

/** Entry types in the KFN directory. */
export const KfnEntryType = {
  SongIni: 1,
  Music: 2,
  Image: 3,
  Font: 4,
  Video: 5,
} as const

export type KfnHeaderValue = number | Uint8Array

export interface KfnEntry {
  name: string
  type: number
  /** Real (decrypted) size in bytes. */
  length: number
  /** Offset relative to the end of the directory. */
  offset: number
  /** Stored size; padded to the AES block size when encrypted. */
  storedLength: number
  flags: number
  encrypted: boolean
  /** Entry contents, decrypted if needed. */
  data: Uint8Array
}

export interface KfnMeta {
  title: string
  artist: string
  album: string
  composer: string
  /** Raw SORC value, e.g. `1,I,song.mp3`. */
  source: string
}

export interface KfnFile {
  header: Map<string, KfnHeaderValue>
  meta: KfnMeta
  /** AES key from the FLID header field, or null when absent or all zero. */
  key: Uint8Array | null
  entries: KfnEntry[]
}

export class KfnParseError extends Error {
  override name = 'KfnParseError'
}

/** Thrown when the input ends early; callers reading a file prefix can retry with more bytes. */
export class KfnTruncatedError extends KfnParseError {
  override name = 'KfnTruncatedError'
}

const MAGIC = 'KFNB'
const ENCRYPTED_FLAG = 1

class Reader {
  private readonly view: DataView
  pos = 0

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(n: number, what: string): void {
    if (this.pos + n > this.bytes.byteLength) {
      throw new KfnTruncatedError(`Unexpected end of file while reading ${what} at offset ${this.pos}`)
    }
  }

  u8(what: string): number {
    this.need(1, what)
    return this.view.getUint8(this.pos++)
  }

  u32(what: string): number {
    this.need(4, what)
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }

  i32(what: string): number {
    this.need(4, what)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  bytesOf(n: number, what: string): Uint8Array {
    this.need(n, what)
    const b = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }

  ascii(n: number, what: string): string {
    return String.fromCharCode(...this.bytesOf(n, what))
  }
}

function readHeader(r: Reader): Map<string, KfnHeaderValue> {
  const header = new Map<string, KfnHeaderValue>()
  for (;;) {
    const tag = r.ascii(4, 'header tag')
    const type = r.u8(`type of header tag ${tag}`)
    if (type === 1) {
      header.set(tag, r.i32(`value of header tag ${tag}`))
    } else if (type === 2) {
      const len = r.u32(`length of header tag ${tag}`)
      header.set(tag, r.bytesOf(len, `value of header tag ${tag}`))
    } else {
      throw new KfnParseError(`Unknown type ${type} for header tag ${tag} at offset ${r.pos - 1}`)
    }
    if (tag === 'ENDH') return header
  }
}

function headerString(header: Map<string, KfnHeaderValue>, tag: string): string {
  const v = header.get(tag)
  return v instanceof Uint8Array ? decodeText(v) : ''
}

function headerKey(header: Map<string, KfnHeaderValue>): Uint8Array | null {
  const v = header.get('FLID')
  if (!(v instanceof Uint8Array) || v.length !== 16 || v.every((b) => b === 0)) return null
  return v
}

function metaOf(header: Map<string, KfnHeaderValue>): KfnMeta {
  return {
    title: headerString(header, 'TITL'),
    artist: headerString(header, 'ARTS'),
    album: headerString(header, 'ALBM'),
    composer: headerString(header, 'COMP'),
    source: headerString(header, 'SORC'),
  }
}

function readMagicAndHeader(r: Reader): Map<string, KfnHeaderValue> {
  const magic = r.bytes.byteLength >= 4 ? r.ascii(4, 'magic') : ''
  if (magic !== MAGIC) throw new KfnParseError('Not a KFN file (missing KFNB signature)')
  return readHeader(r)
}

/**
 * Parse only the KFN header (metadata tags). Works on a prefix of the file;
 * throws {@link KfnTruncatedError} if the prefix is too short.
 */
export function parseKfnHeader(input: ArrayBuffer | Uint8Array): Pick<KfnFile, 'header' | 'meta'> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const header = readMagicAndHeader(new Reader(bytes))
  return { header, meta: metaOf(header) }
}

/** Parse a KaraFun `.kfn` file. */
export function parseKfn(input: ArrayBuffer | Uint8Array): KfnFile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const r = new Reader(bytes)
  const header = readMagicAndHeader(r)
  const key = headerKey(header)

  const count = r.u32('directory entry count')
  const dir: Omit<KfnEntry, 'data' | 'encrypted'>[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = r.u32(`name length of entry ${i}`)
    const name = decodeText(r.bytesOf(nameLen, `name of entry ${i}`))
    const type = r.u32(`type of entry ${name}`)
    const length = r.u32(`length of entry ${name}`)
    const offset = r.u32(`offset of entry ${name}`)
    const storedLength = r.u32(`stored length of entry ${name}`)
    const flags = r.u32(`flags of entry ${name}`)
    dir.push({ name, type, length, offset, storedLength, flags })
  }
  const base = r.pos

  const entries = dir.map((e): KfnEntry => {
    const start = base + e.offset
    const end = start + e.storedLength
    if (end > bytes.byteLength) {
      throw new KfnParseError(`Entry ${e.name} extends past end of file`)
    }
    const stored = bytes.subarray(start, end)
    const encrypted = (e.flags & ENCRYPTED_FLAG) !== 0
    let data = stored
    if (encrypted) {
      if (!key) throw new KfnParseError(`Entry ${e.name} is encrypted but the file has no key`)
      if (e.storedLength % 16 !== 0) {
        throw new KfnParseError(`Encrypted entry ${e.name} is not a multiple of the AES block size`)
      }
      data = ecb(key, { disablePadding: true }).decrypt(stored)
    }
    if (e.length > data.byteLength) {
      throw new KfnParseError(`Entry ${e.name} is shorter than its declared length`)
    }
    return { ...e, encrypted, data: data.subarray(0, e.length) }
  })

  return {
    header,
    key,
    entries,
    meta: metaOf(header),
  }
}

export function findEntry(kfn: KfnFile, name: string): KfnEntry | undefined {
  const lower = name.toLowerCase()
  return kfn.entries.find((e) => e.name.toLowerCase() === lower)
}
