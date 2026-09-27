/** Effect IDs seen in KaraFun Song.ini files. */
export const EffectId = {
  Lyrics: 1,
  Background: 51,
  Video: 62,
} as const

/** One action of a timed animation, e.g. `ChgBgImg` with `LibImage`, `Effect`, `TransitionTime`. */
export interface AnimAction {
  type: string
  params: Record<string, string>
}

/** `AnimN=<time cs>|<Action>:<k=v,...>|...` */
export interface Animation {
  timeCs: number
  actions: AnimAction[]
}

export type IniSection = Map<string, string>

export interface LyricsStyle {
  fontFamily: string
  fontSize: number
  /** CSS colors converted from KaraFun `#RRGGBBAA`. */
  activeColor: string
  inactiveColor: string
  frameColor: string
  inactiveFrameColor: string
  alignment: 'left' | 'center' | 'right'
  trajectory: string
}

export interface LyricsEffect {
  kind: 'lyrics'
  /** Raw `TextN` lines; `/` splits syllables, empty lines are breaks. */
  texts: string[]
  /** Syllable start times in centiseconds, concatenated from `SyncN`. */
  syncs: number[]
  style: LyricsStyle
  /** Raw `SelTextEffect`, e.g. `LittleShake*8.000000*1*1*1`: an effect on the syllable being sung. */
  selTextEffect: string
}

export interface BackgroundEffect {
  kind: 'background'
  image: string | null
  color: string
  /** Raw `#RRGGBBAA` tint/opacity of the image. */
  imageColor: string
  depth: number
}

export interface VideoEffect {
  kind: 'video'
  /** Entry name, or `UseMusicSource`. */
  videoFile: string
  loop: boolean
  /** `SeekTime`, assumed to be centiseconds like other times (0 in all known files). */
  seekCs: number
  displayLastFrame: boolean
}

export interface OtherEffect {
  kind: 'other'
  id: number
}

export type Effect = (LyricsEffect | BackgroundEffect | VideoEffect | OtherEffect) & {
  section: string
  enabled: boolean
  raw: IniSection
  /** Position offset in KaraFun canvas units (800×600 reference). */
  offsetX: number
  offsetY: number
  animations: Animation[]
}

export interface SongIni {
  sections: Map<string, IniSection>
  title: string
  artist: string
  album: string
  /** Name of the music entry to play, taken from `Source=1,I,<file>`. */
  musicFile: string | null
  /** `GlobalShift` in centiseconds (unit assumed; zero in all known files). */
  globalShift: number
  effects: Effect[]
}

export function parseIni(text: string): Map<string, IniSection> {
  const sections = new Map<string, IniSection>()
  let current: IniSection | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = new Map()
      sections.set(header[1]!, current)
      continue
    }
    const eq = rawLine.indexOf('=')
    if (eq < 0 || !current) continue
    // Keep the value untrimmed on the right side of '=' except line endings;
    // lyric lines may legitimately start or end with spaces.
    current.set(rawLine.slice(0, eq).trim(), rawLine.slice(eq + 1).replace(/\r$/, ''))
  }
  return sections
}

export interface KfnRgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  alpha: number
}

/** Parse KaraFun `#RRGGBB` / `#RRGGBBAA`. */
export function parseKfnHex(value: string | undefined): KfnRgba | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value?.trim() ?? '')
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as [number, number, number]
  return { r, g, b, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 }
}

/** Convert KaraFun `#RRGGBB` / `#RRGGBBAA` to a CSS color. */
export function kfnColor(value: string | undefined, fallback: string): string {
  const c = parseKfnHex(value)
  if (!c) return fallback
  return c.alpha === 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${+c.alpha.toFixed(3)})`
}

function int(value: string | undefined, fallback = 0): number {
  const n = parseInt(value ?? '', 10)
  return Number.isNaN(n) ? fallback : n
}

/** A decimal number from an INI or animation value, or `fallback`. */
export function float(value: string | undefined, fallback = 0): number {
  const n = parseFloat(value ?? '')
  return Number.isNaN(n) ? fallback : n
}

function numberedValues(section: IniSection, prefix: string): string[] {
  const count = int(section.get(`${prefix}Count`), -1)
  const out: string[] = []
  for (let i = 0; count < 0 || i < count; i++) {
    const v = section.get(`${prefix}${i}`)
    if (v === undefined) {
      if (count < 0) break
      out.push('')
    } else {
      out.push(v)
    }
  }
  return out
}

function parseStyle(s: IniSection): LyricsStyle {
  const [fontFamily = 'Arial', size = '18'] = (s.get('Font') ?? '').split('*')
  const align = (s.get('Alignment') ?? 'Center').toLowerCase()
  return {
    fontFamily: fontFamily || 'Arial',
    fontSize: float(size, 18) || 18,
    activeColor: kfnColor(s.get('ActiveColor'), 'rgb(255 64 64)'),
    inactiveColor: kfnColor(s.get('InactiveColor'), 'rgb(255 255 255)'),
    frameColor: kfnColor(s.get('FrameColor'), 'rgb(0 0 0)'),
    inactiveFrameColor: kfnColor(s.get('InactiveFrameColor'), 'rgb(0 0 0)'),
    alignment: align === 'left' || align === 'right' ? align : 'center',
    trajectory: (s.get('Trajectory') ?? '').split('*')[0] ?? '',
  }
}

/**
 * Parse one `AnimN` value. Parameters are split only at commas followed by
 * `Key=`, because image file names may contain commas.
 */
export function parseAnimation(value: string): Animation | null {
  const [time, ...parts] = value.split('|')
  const timeCs = parseInt(time ?? '', 10)
  if (Number.isNaN(timeCs)) return null
  const actions = parts.flatMap((part): AnimAction[] => {
    const colon = part.indexOf(':')
    if (colon < 0) return part.trim() ? [{ type: part.trim(), params: {} }] : []
    const params: Record<string, string> = {}
    for (const pair of part.slice(colon + 1).split(/,(?=[A-Za-z]+=)/)) {
      const eq = pair.indexOf('=')
      if (eq > 0) params[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    return [{ type: part.slice(0, colon).trim(), params }]
  })
  return { timeCs, actions }
}

function parseAnimations(s: IniSection): Animation[] {
  const count = int(s.get('NbAnim'), 0)
  const out: Animation[] = []
  for (let i = 0; i < count; i++) {
    const anim = parseAnimation(s.get(`Anim${i}`) ?? '')
    if (anim) out.push(anim)
  }
  return out.sort((a, b) => a.timeCs - b.timeCs)
}

function parseEffect(section: string, s: IniSection): Effect {
  const id = int(s.get('ID'), -1)
  const common = {
    section,
    raw: s,
    // KaraFun writes Visual Basic style booleans: -1 is true.
    enabled: int(s.get('Enabled'), -1) !== 0,
    offsetX: float(s.get('OffsetX')),
    offsetY: float(s.get('OffsetY')),
    animations: parseAnimations(s),
  }
  if (id === EffectId.Lyrics) {
    const syncs = numberedValues(s, 'Sync')
      .flatMap((line) => line.split(','))
      .map((v) => v.trim())
      .filter((v) => v !== '')
      .map((v) => int(v))
    return {
      ...common,
      kind: 'lyrics',
      texts: numberedValues(s, 'Text'),
      syncs,
      style: parseStyle(s),
      selTextEffect: s.get('SelTextEffect') ?? '',
    }
  }
  if (id === EffectId.Background) {
    return {
      ...common,
      kind: 'background',
      image: s.get('LibImage') || null,
      color: kfnColor(s.get('Color'), 'rgb(0 0 0)'),
      imageColor: s.get('ImageColor') ?? '#FFFFFFFF',
      depth: float(s.get('Depth')),
    }
  }
  if (id === EffectId.Video) {
    return {
      ...common,
      kind: 'video',
      videoFile: s.get('VideoFile') ?? '',
      loop: int(s.get('LoopVideo'), 0) !== 0,
      seekCs: int(s.get('SeekTime'), 0),
      displayLastFrame: int(s.get('DisplayLastFrame'), 0) !== 0,
    }
  }
  return { ...common, kind: 'other', id }
}

export function parseSongIni(text: string): SongIni {
  const sections = parseIni(text)
  const general = sections.get('General') ?? new Map<string, string>()
  const source = general.get('Source') ?? ''
  // Source looks like "1,I,file.mp3"; the file name itself may contain commas.
  const musicFile = source.split(',').slice(2).join(',').trim() || null

  const effects: Effect[] = []
  const effectCount = int(general.get('EffectCount'), 0)
  for (let i = 1; i <= effectCount; i++) {
    const s = sections.get(`Eff${i}`)
    if (s) effects.push(parseEffect(`Eff${i}`, s))
  }

  return {
    sections,
    title: general.get('Title') ?? '',
    artist: general.get('Artist') ?? '',
    album: general.get('Album') ?? '',
    musicFile,
    globalShift: int(general.get('GlobalShift'), 0),
    effects,
  }
}
