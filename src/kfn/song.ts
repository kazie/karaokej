import {
  buildTrack,
  colorStep,
  easingFor,
  fadeStep,
  floatStep,
  imageColor,
  selTextEffect,
  still,
  transitionKind,
  type ImageColor,
  type Keyframe,
  type SelTextEffect,
  type TransitionKind,
} from './effects'
import { findEntry, KfnEntryType, type KfnEntry, type KfnFile } from './parseKfn'
import {
  float,
  parseSongIni,
  trajectoryName,
  type Effect,
  type LyricsStyle,
  type SongIni,
} from './parseSongIni'
import { decodeTextByLine } from './text'
import { buildTimeline, type Timeline } from './timeline'

/** Lyric properties that songs animate over time. */
export interface LyricsEffects {
  activeColor: Keyframe<string>[]
  inactiveColor: Keyframe<string>[]
  frameColor: Keyframe<string>[]
  inactiveFrameColor: Keyframe<string>[]
  /** Effect on the syllable being sung. */
  selText: Keyframe<SelTextEffect>[]
  /** KaraFun canvas units (800×600 reference). */
  offsetX: Keyframe<number>[]
  offsetY: Keyframe<number>[]
  /** How lines move (see {@link lineMotion}); songs may switch it with `ChgTrajectory`. */
  trajectory: Keyframe<string>[]
}

export interface LyricsTrack {
  style: LyricsStyle
  timeline: Timeline
  effects: LyricsEffects
  /** Who sings this track, e.g. `Dejiko`; empty when not named. */
  caption: string
}

/**
 * Largest believable KaraFun font size. Some files have backing-vocal tracks
 * at sizes like 530 that would fill the screen many times over.
 */
const MAX_FONT_SIZE = 100
const DEFAULT_FONT_SIZE = 18

/** The picture background and everything that changes it over time. */
export interface Backdrop {
  /** null: no picture, just the color. */
  image: Keyframe<KfnEntry | null>[]
  /** How each picture change in `image` comes in (same keyframe times). */
  imageTransition: Keyframe<TransitionKind>[]
  color: Keyframe<string>[]
  imageColor: Keyframe<ImageColor>[]
  offsetX: Keyframe<number>[]
  offsetY: Keyframe<number>[]
  /** Negative is closer (zoomed in). */
  depth: Keyframe<number>[]
}

export interface VideoBackground {
  entry: KfnEntry
  loop: boolean
  /** Video position when the song starts. */
  seekMs: number
  displayLastFrame: boolean
}

export interface KaraokeSong {
  title: string
  artist: string
  album: string
  ini: SongIni
  music: KfnEntry | null
  backdrop: Backdrop
  video: VideoBackground | null
  lyrics: LyricsTrack[]
  warnings: string[]
}

function offsetTracks(e: Effect, shift: number) {
  return {
    offsetX: buildTrack(e.offsetX, e.animations, shift, (a) => floatStep(a, 'ChgFloatOffsetX')),
    offsetY: buildTrack(e.offsetY, e.animations, shift, (a) => floatStep(a, 'ChgFloatOffsetY')),
  }
}

function lyricsEffects(e: Extract<Effect, { kind: 'lyrics' }>, shift: number): LyricsEffects {
  const color = (
    key: 'activeColor' | 'inactiveColor' | 'frameColor' | 'inactiveFrameColor',
    action: string,
  ) => buildTrack(e.style[key], e.animations, shift, (a) => colorStep(a, action, e.style[key]))
  return {
    activeColor: color('activeColor', 'ChgColActiveColor'),
    inactiveColor: color('inactiveColor', 'ChgColInactiveColor'),
    frameColor: color('frameColor', 'ChgColFrameColor'),
    inactiveFrameColor: color('inactiveFrameColor', 'ChgColInactiveFrameColor'),
    selText: buildTrack(selTextEffect(e.selTextEffect), e.animations, shift, (a) =>
      a.type === 'ChgSelTextEffect' ? { value: selTextEffect(a.params.Trajectory) } : undefined,
    ),
    trajectory: buildTrack(e.style.trajectory, e.animations, shift, (a) =>
      a.type === 'ChgTrajectory' ? { value: trajectoryName(a.params.Trajectory) } : undefined,
    ),
    ...offsetTracks(e, shift),
  }
}

function backdrop(kfn: KfnFile, e: Effect | undefined, shift: number, warnings: string[]): Backdrop {
  if (e?.kind !== 'background') {
    return {
      image: still(null),
      imageTransition: still<TransitionKind>('cut'),
      color: still('rgb(0 0 0)'),
      imageColor: still(imageColor(undefined)),
      offsetX: still(0),
      offsetY: still(0),
      depth: still(0),
    }
  }
  const lookup = (name: string) => {
    const entry = findEntry(kfn, name)
    if (!entry) warnings.push(`Background image ${name} not found`)
    return entry
  }
  const initial = e.image ? (lookup(e.image) ?? null) : null
  return {
    image: buildTrack<KfnEntry | null>(initial, e.animations, shift, (a) => {
      if (a.type !== 'ChgBgImg' || !a.params.LibImage) return undefined
      const entry = lookup(a.params.LibImage)
      if (!entry) return undefined // keep the previous picture
      const instant = transitionKind(a.params.Effect) === 'cut'
      return {
        value: entry,
        transitionCs: instant ? 0 : float(a.params.TransitionTime),
        easing: easingFor(a.params.TransType),
      }
    }),
    // Same picture changes as `image` (missing pictures skipped there too), so the keyframes line up.
    imageTransition: buildTrack<TransitionKind>('cut', e.animations, shift, (a) =>
      a.type === 'ChgBgImg' && a.params.LibImage && findEntry(kfn, a.params.LibImage)
        ? { value: transitionKind(a.params.Effect) }
        : undefined,
    ),
    color: buildTrack(e.color, e.animations, shift, (a) => colorStep(a, 'ChgColColor', e.color)),
    imageColor: buildTrack(imageColor(e.imageColor), e.animations, shift, (a) =>
      fadeStep(a, 'ChgColImageColor', imageColor),
    ),
    depth: buildTrack(e.depth, e.animations, shift, (a) => floatStep(a, 'ChgFloatDepth')),
    ...offsetTracks(e, shift),
  }
}

function videoBackground(
  kfn: KfnFile,
  e: Effect | undefined,
  music: KfnEntry | null,
  warnings: string[],
): VideoBackground | null {
  if (e?.kind !== 'video') return null
  let entry: KfnEntry | undefined
  if (e.videoFile === 'UseMusicSource') {
    entry =
      kfn.entries.find((x) => x.type === KfnEntryType.Video) ??
      (music && sniffMime(music).startsWith('video/') ? music : undefined)
  } else {
    entry = findEntry(kfn, e.videoFile)
  }
  if (!entry) {
    warnings.push(`Video ${e.videoFile} not found`)
    return null
  }
  return {
    entry,
    loop: e.loop,
    // Not shifted: GlobalShift aligns lyrics and animations, while the video follows the music clock.
    seekMs: Math.max(0, e.seekCs * 10),
    displayLastFrame: e.displayLastFrame,
  }
}

/** Combine a parsed KFN container and its Song.ini into something playable. */
export function loadSong(kfn: KfnFile): KaraokeSong {
  const iniEntry = kfn.entries.find((e) => e.type === KfnEntryType.SongIni)
  if (!iniEntry) throw new Error('KFN file has no Song.ini')
  const ini = parseSongIni(decodeTextByLine(iniEntry.data))
  const shift = ini.globalShift
  const warnings: string[] = []

  let music = ini.musicFile ? (findEntry(kfn, ini.musicFile) ?? null) : null
  if (!music) {
    music = kfn.entries.find((e) => e.type === KfnEntryType.Music) ?? null
    if (ini.musicFile) warnings.push(`Source ${ini.musicFile} not found; using ${music?.name ?? 'nothing'}`)
  }

  const enabled = (kind: Effect['kind']) => ini.effects.find((e) => e.kind === kind && e.enabled)

  const lyricEffects = ini.effects.filter(
    (e): e is Extract<Effect, { kind: 'lyrics' }> => e.kind === 'lyrics' && e.enabled,
  )
  // Oversized tracks take the size of the song's other lyrics.
  const normalSize =
    lyricEffects.map((e) => e.style.fontSize).find((size) => size <= MAX_FONT_SIZE) ?? DEFAULT_FONT_SIZE
  const lyrics = lyricEffects.map((e): LyricsTrack => {
    const timeline = buildTimeline(e, shift)
    warnings.push(...timeline.warnings.map((w) => `${e.section}: ${w}`))
    const style = e.style.fontSize > MAX_FONT_SIZE ? { ...e.style, fontSize: normalSize } : e.style
    return { style, timeline, effects: lyricsEffects(e, shift), caption: e.caption }
  })

  return {
    title: ini.title || kfn.meta.title,
    artist: ini.artist || kfn.meta.artist,
    album: ini.album || kfn.meta.album,
    ini,
    music,
    backdrop: backdrop(kfn, enabled('background'), shift, warnings),
    video: videoBackground(kfn, enabled('video'), music, warnings),
    lyrics,
    warnings,
  }
}

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avi: 'video/x-msvideo',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export function mimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** Start of an ASF (WMA/WMV) file: its header object's GUID. */
const ASF_HEADER = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]

/**
 * Media type from the file's content, falling back to its name. KaraFun files
 * often carry MP4 or WebM video under an `.avi` name.
 */
export function sniffMime(entry: Pick<KfnEntry, 'name' | 'data'>): string {
  const b = entry.data
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  if (ascii(b, 4, 8) === 'ftyp') return entry.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'video/mp4'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'AVI ') return 'video/x-msvideo'
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (ASF_HEADER.every((byte, i) => b[i] === byte)) return 'audio/x-ms-wma'
  return mimeType(entry.name)
}

/** Music formats no browser plays, with a name to tell the user. */
const UNPLAYABLE_MUSIC: Record<string, string> = { 'audio/x-ms-wma': 'WMA' }

/** Why `music` can't be played in a browser, or null if it can (as far as we know). */
export function unplayableMusic(music: KfnEntry): string | null {
  const format = UNPLAYABLE_MUSIC[sniffMime(music)]
  return format ? `This song’s music is ${format}, which browsers can’t play` : null
}

export function entryBlob(entry: KfnEntry): Blob {
  return new Blob([entry.data as Uint8Array<ArrayBuffer>], { type: sniffMime(entry) })
}
