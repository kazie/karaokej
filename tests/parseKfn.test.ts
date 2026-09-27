import { describe, expect, it } from 'vitest'
import { buildKfn } from '../src/kfn/buildKfn'
import {
  findEntry,
  KfnEntryType,
  KfnParseError,
  KfnTruncatedError,
  parseKfn,
  parseKfnHeader,
} from '../src/kfn/parseKfn'

const enc = new TextEncoder()
const key = enc.encode('0123456789abcdef')

function sample(encrypt = false): Uint8Array {
  return buildKfn({
    header: { DIFM: 0, TITL: 'Title', ARTS: 'Artist', ALBM: 'Album', SORC: '1,I,song.mp3' },
    key: encrypt ? key : undefined,
    entries: [
      { name: 'song.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33, 1, 2, 3) },
      { name: 'bg.png', type: KfnEntryType.Image, data: new Uint8Array(40).fill(7), encrypt },
      { name: 'Song.ini', type: KfnEntryType.SongIni, data: enc.encode('[General]\r\nTitle=Å'), encrypt },
    ],
  })
}

describe('parseKfn', () => {
  it('reads header metadata', () => {
    const kfn = parseKfn(sample())
    expect(kfn.meta).toEqual({
      title: 'Title',
      artist: 'Artist',
      album: 'Album',
      composer: '',
      source: '1,I,song.mp3',
    })
    expect(kfn.header.get('DIFM')).toBe(0)
    expect(kfn.header.get('ENDH')).toBe(-1)
    expect(kfn.key).toBeNull()
  })

  it('reads directory entries and their data', () => {
    const kfn = parseKfn(sample())
    expect(kfn.entries.map((e) => [e.name, e.type, e.length, e.encrypted])).toEqual([
      ['song.mp3', 2, 6, false],
      ['bg.png', 3, 40, false],
      ['Song.ini', 1, 19, false],
    ])
    expect([...findEntry(kfn, 'SONG.MP3')!.data]).toEqual([0x49, 0x44, 0x33, 1, 2, 3])
    expect(new TextDecoder().decode(findEntry(kfn, 'song.ini')!.data)).toBe('[General]\r\nTitle=Å')
  })

  it('accepts an ArrayBuffer', () => {
    const bytes = sample()
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    expect(parseKfn(copy).entries).toHaveLength(3)
  })

  it('decrypts AES-ECB entries with the FLID key', () => {
    const kfn = parseKfn(sample(true))
    expect([...kfn.key!]).toEqual([...key])
    const ini = findEntry(kfn, 'Song.ini')!
    expect(ini.encrypted).toBe(true)
    expect(ini.storedLength).toBe(32)
    expect(new TextDecoder().decode(ini.data)).toBe('[General]\r\nTitle=Å')
    expect(findEntry(kfn, 'bg.png')!.data).toEqual(new Uint8Array(40).fill(7))
  })

  it('stores encrypted data scrambled', () => {
    const bytes = sample(true)
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).not.toContain('[General]')
  })

  it('rejects files without the KFNB signature', () => {
    expect(() => parseKfn(enc.encode('RIFF....'))).toThrow(KfnParseError)
    expect(() => parseKfn(new Uint8Array())).toThrow(/KFNB/)
  })

  it('reports truncated files', () => {
    const bytes = sample()
    expect(() => parseKfn(bytes.subarray(0, 30))).toThrow(/Unexpected end of file/)
    expect(() => parseKfn(bytes.subarray(0, bytes.length - 5))).toThrow(/past end of file/)
  })

  it('reports an encrypted entry without a key', () => {
    const bytes = buildKfn({
      key,
      entries: [{ name: 'a', type: 1, data: new Uint8Array(16), encrypt: true }],
    })
    // Zero out the FLID value (right after the 'FLID', type byte and length).
    const flid = new TextDecoder('latin1').decode(bytes).indexOf('FLID') + 9
    bytes.fill(0, flid, flid + 16)
    expect(() => parseKfn(bytes)).toThrow(/no key/)
  })
})

describe('parseKfnHeader', () => {
  it('reads metadata from a file prefix', () => {
    const bytes = sample()
    const end = new TextDecoder('latin1').decode(bytes).indexOf('ENDH') + 9
    expect(parseKfnHeader(bytes.subarray(0, end)).meta.title).toBe('Title')
  })

  it('throws KfnTruncatedError on a too-short prefix', () => {
    expect(() => parseKfnHeader(sample().subarray(0, 20))).toThrow(KfnTruncatedError)
  })
})
