import { ecb } from '@noble/ciphers/aes.js'

/**
 * Minimal KFN writer. Used to build test fixtures and demo songs so the
 * project never has to ship real (copyrighted) karaoke files.
 */

export interface BuildEntry {
  name: string
  type: number
  data: Uint8Array
  encrypt?: boolean
}

export interface BuildKfnOptions {
  header?: Record<string, number | string | Uint8Array>
  entries: BuildEntry[]
  /** 16-byte AES key written to FLID; required when any entry is encrypted. */
  key?: Uint8Array
}

const encoder = new TextEncoder()

/** Join byte arrays into one. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** Latin-1 / windows-1252 bytes for text in the Latin-1 range (e.g. "Ö"). */
export const latin1Bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)

class Writer {
  private chunks: Uint8Array[] = []

  bytes(b: Uint8Array): void {
    this.chunks.push(b)
  }

  ascii(s: string): void {
    this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)))
  }

  u8(v: number): void {
    this.bytes(Uint8Array.of(v))
  }

  u32(v: number): void {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0, true)
    this.bytes(b)
  }

  finish(): Uint8Array {
    return concatBytes(this.chunks)
  }
}

export function buildKfn({ header = {}, entries, key }: BuildKfnOptions): Uint8Array {
  const w = new Writer()
  w.ascii('KFNB')

  const tags: Record<string, number | string | Uint8Array> = {
    ...header,
    FLID: key ?? new Uint8Array(16),
  }
  for (const [tag, value] of Object.entries(tags)) {
    w.ascii(tag.padEnd(4).slice(0, 4))
    if (typeof value === 'number') {
      w.u8(1)
      w.u32(value)
    } else {
      const b = typeof value === 'string' ? encoder.encode(value) : value
      w.u8(2)
      w.u32(b.length)
      w.bytes(b)
    }
  }
  w.ascii('ENDH')
  w.u8(1)
  w.u32(0xffffffff)

  const stored = entries.map((e) => {
    if (!e.encrypt) return e.data
    if (!key) throw new Error(`Entry ${e.name} is encrypted but no key was given`)
    const padded = new Uint8Array(Math.ceil(e.data.length / 16) * 16)
    padded.set(e.data)
    return ecb(key, { disablePadding: true }).encrypt(padded)
  })

  w.u32(entries.length)
  let offset = 0
  entries.forEach((e, i) => {
    const name = encoder.encode(e.name)
    const data = stored[i]!
    w.u32(name.length)
    w.bytes(name)
    w.u32(e.type)
    w.u32(e.data.length)
    w.u32(offset)
    w.u32(data.length)
    w.u32(e.encrypt ? 1 : 0)
    offset += data.length
  })
  stored.forEach((d) => w.bytes(d))
  return w.finish()
}

/** One lyrics track (effect ID 1) of a Song.ini. */
export interface SongIniLyrics {
  texts: string[]
  /** Centiseconds, one per syllable. */
  syncs: number[]
  font?: string
  activeColor?: string
  inactiveColor?: string
  frameColor?: string
  inactiveFrameColor?: string
  /** `AnimN` values (`<cs>|<Action>:<k=v,...>`) for the lyrics effect. */
  lyricsAnims?: string[]
}

export interface SongIniOptions extends SongIniLyrics {
  title?: string
  artist?: string
  album?: string
  musicFile: string
  backgroundImage?: string
  /** `AnimN` values for the background effect. */
  backgroundAnims?: string[]
  /** More lyrics tracks after the first (duets, backing vocals). */
  moreLyrics?: SongIniLyrics[]
}

const animLines = (anims: string[] = []) => [
  `NbAnim=${anims.length}`,
  ...anims.map((a, i) => `Anim${i}=${a}`),
]

function lyricsEffect(o: SongIniLyrics): string[] {
  const syncLines: string[] = []
  for (let i = 0; i < o.syncs.length; i += 40) {
    syncLines.push(`Sync${syncLines.length}=${o.syncs.slice(i, i + 40).join(',')}`)
  }
  return [
    'ID=1',
    'Enabled=-1',
    ...syncLines,
    `Font=${o.font ?? 'Arial*18'}`,
    `ActiveColor=${o.activeColor ?? '#1F6AB6FF'}`,
    `InactiveColor=${o.inactiveColor ?? '#E8EFF3FF'}`,
    `FrameColor=${o.frameColor ?? '#000000FF'}`,
    `InactiveFrameColor=${o.inactiveFrameColor ?? '#CF5650FF'}`,
    'FrameType=Frame3',
    'Alignment=Center',
    'Trajectory=PlainBottomToTop*1.000000*1.000000*1.000000*1.000000',
    ...animLines(o.lyricsAnims),
    `TextCount=${o.texts.length}`,
    ...o.texts.map((t, i) => `Text${i}=${t}`),
  ]
}

/** Write a Song.ini in the layout KaraFun Studio produces. */
export function songIniText(o: SongIniOptions): string {
  const effects: string[][] = []
  if (o.backgroundImage) {
    effects.push([
      'ID=51',
      'Enabled=-1',
      'Color=#000000',
      `LibImage=${o.backgroundImage}`,
      ...animLines(o.backgroundAnims),
    ])
  }
  for (const lyrics of [o, ...(o.moreLyrics ?? [])]) effects.push(lyricsEffect(lyrics))

  return [
    '[General]',
    `Title=${o.title ?? ''}`,
    `Artist=${o.artist ?? ''}`,
    `Album=${o.album ?? ''}`,
    `Source=1,I,${o.musicFile}`,
    `EffectCount=${effects.length}`,
    'GlobalShift=0',
    '',
    ...effects.flatMap((lines, i) => [`[Eff${i + 1}]`, ...lines, '']),
  ].join('\r\n')
}
