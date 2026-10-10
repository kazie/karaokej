import { describe, expect, it } from 'vitest'
import {
  DEMO_MUSIC_FILE,
  DEMO_TEXTS,
  GROUP_SINGERS,
  makeDemoKfn,
  makeDuetDemoKfn,
  makeGroupDemoKfn,
} from '../src/demo/demoSong'
import { buildKfn, songIniText } from '../src/kfn/buildKfn'
import { KfnEntryType, parseKfn } from '../src/kfn/parseKfn'
import { loadSong, mimeType, sniffMime, unplayableMusic } from '../src/kfn/song'
import { buildGaps, lineWindows, shownAt } from '../src/kfn/timeline'

type KfnEntries = Parameters<typeof buildKfn>[0]['entries']

/** Load a song from this Song.ini, plus any other entries. */
const songFromIni = (ini: string, entries: KfnEntries = []) =>
  loadSong(
    parseKfn(
      buildKfn({
        entries: [
          ...entries,
          { name: 'Song.ini', type: KfnEntryType.SongIni, data: new TextEncoder().encode(ini) },
        ],
      }),
    ),
  )

describe('loadSong', () => {
  it.each([false, true])('loads the demo song (encrypted: %s)', (encrypted) => {
    const song = loadSong(parseKfn(makeDemoKfn({ encrypted })))
    expect(song.title).toBe('Demo Song')
    expect(song.music?.name).toBe(DEMO_MUSIC_FILE)
    expect(song.backdrop.image[0]?.value?.entry.name).toBe('demo.svg')
    expect(song.warnings).toEqual([])
    expect(song.lyrics).toHaveLength(1)
    expect(song.lyrics[0]!.timeline.lines).toHaveLength(DEMO_TEXTS.length)
    expect(song.lyrics[0]!.style.activeColor).toBe('rgb(199 229 92)')
  })

  it('loads the duet demo: a long intro, then one singer waits while the other sings', () => {
    const song = loadSong(parseKfn(makeDuetDemoKfn()))
    expect(song.warnings).toEqual([])
    const [first, second] = song.lyrics.map((l) => l.timeline)
    expect(song.lyrics).toHaveLength(2)
    expect(buildGaps([first!, second!])[0]).toEqual({ startMs: 0, endMs: 6000 })
    const shown = (t: typeof first, ms: number) => lineWindows(t!, 3000).map((w) => shownAt(w, ms))
    expect(shown(first, 2000)).toEqual([false, false, false]) // intro
    expect(shown(second, 8000)).toEqual([false, false, false]) // singer one's verse
    expect(shown(first, 18_000)).toEqual([false, false, false]) // singer two's verse
    expect(shown(first, 21_000)).toEqual([false, false, true]) // lead-in to the last line only
  })

  it('falls back to the first music entry when Source is missing', () => {
    const ini = songIniText({ musicFile: 'gone.mp3', texts: ['a'], syncs: [1] })
    const song = songFromIni(ini, [{ name: 'x.mp3', type: KfnEntryType.Music, data: new Uint8Array(4) }])
    expect(song.music?.name).toBe('x.mp3')
    expect(song.warnings[0]).toMatch(/gone\.mp3 not found/)
  })

  it('gives oversized tracks the size of the other lyrics, and keeps captions', () => {
    const ini = songIniText({
      musicFile: 'm.mp3',
      texts: ['a'],
      syncs: [1],
      font: 'Arial*24',
      caption: 'Lead',
      moreLyrics: [{ texts: ['b'], syncs: [2], font: 'Arial*530' }],
    })
    const [lead, backing] = songFromIni(ini).lyrics
    expect(lead!.style.fontSize).toBe(24)
    expect(backing!.style.fontSize).toBe(24)
    expect(lead!.caption).toBe('Lead')
    expect(backing!.caption).toBe('')
  })

  it('loads the group demo: a named track per singer', () => {
    const song = loadSong(parseKfn(makeGroupDemoKfn()))
    expect(song.warnings).toEqual([])
    expect(song.lyrics.map((l) => l.caption)).toEqual(GROUP_SINGERS.map((s) => s.caption))
  })

  it('requires a Song.ini', () => {
    expect(() => loadSong(parseKfn(buildKfn({ entries: [] })))).toThrow(/Song\.ini/)
  })
})

describe('unplayableMusic', () => {
  const asf = Uint8Array.of(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9)
  // ASF header declaring a video stream (its stream type GUID, as stored), after some padding.
  const videoStream = [
    0xc0, 0xef, 0x19, 0xbc, 0x4d, 0x5b, 0xcf, 0x11, 0xa8, 0xfd, 0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
  ]
  const music = (name: string, data: Uint8Array) => ({ name, data })
  const wmv = Uint8Array.of(...asf, 0, 0, 0, 0, ...videoStream, 0, 0)

  it('explains that browsers cannot play WMA, by content or by name', () => {
    expect(sniffMime({ name: 'x.mp3', data: asf })).toBe('audio/x-ms-wma')
    expect(sniffMime({ name: 'song.asf', data: asf })).toBe('audio/x-ms-wma') // content, not the name
    expect(sniffMime({ name: 'clip.wma', data: wmv })).toBe('video/x-ms-wmv')
    expect(unplayableMusic(music('x.mp3', asf))).toMatch(/WMA/)
    expect(unplayableMusic(music('x.asf', wmv))).toMatch(/WMV/)
    expect(unplayableMusic(music('x.wmv', new Uint8Array(8)))).toMatch(/WMV/)
    expect(unplayableMusic(music('x.wma', new Uint8Array(8)))).toMatch(/WMA/)
    expect(unplayableMusic(music('x.mp3', Uint8Array.of(0x49, 0x44, 0x33)))).toBeNull()
  })
})

describe('mimeType', () => {
  it('maps common extensions', () => {
    expect(mimeType('a.MP3')).toBe('audio/mpeg')
    expect(mimeType('b.jpg')).toBe('image/jpeg')
    expect(mimeType('c.flac')).toBe('audio/flac')
    expect(mimeType('d.wma')).toBe('audio/x-ms-wma')
    expect(mimeType('noext')).toBe('application/octet-stream')
  })
})

describe('timed effects', () => {
  const song = loadSong(parseKfn(makeDemoKfn()))

  it('resolves background image changes with their transitions', () => {
    const image = song.backdrop.image
    expect(image.map((f) => [f.value?.entry.name, f.value?.transition, f.transitionMs])).toEqual([
      ['demo.svg', 'cut', 0],
      ['demo2.svg', 'crossfade', 1500], // AlphaBlending, 150 cs
      ['demo3.svg', 'cut', 0], // NoTransition
      ['demo.svg', 'slide-left', 1000], // MoveLeft, 100 cs
    ])
    expect(song.backdrop.depth.map((f) => f.value)).toEqual([0, -2, 0])
  })

  it('resolves animated lyric colors and the sung-syllable effect', () => {
    const effects = song.lyrics[0]!.effects
    expect(effects.activeColor.map((f) => [f.value, f.transitionMs])).toEqual([
      ['rgb(199 229 92)', 0],
      ['rgb(255 179 71)', 1000],
    ])
    expect(effects.selText.map((f) => f.value.name)).toEqual(['NoEffect', 'LittleShake'])
    expect(effects.trajectory.map((f) => f.value)).toEqual(['PlainBottomToTop'])
  })

  it('switches the line motion with ChgTrajectory', () => {
    const ini = songIniText({
      musicFile: 'm.mp3',
      texts: ['a'],
      syncs: [1],
      lyricsAnims: ['500|ChgTrajectory:Trajectory=Still*1.000000*1.000000,TransTime=0'],
    })
    const frames = songFromIni(ini).lyrics[0]!.effects.trajectory
    expect(frames.map((f) => [f.startMs, f.value])).toEqual([
      [0, 'PlainBottomToTop'],
      [5000, 'Still'],
    ])
  })

  it('keeps the previous picture and warns when an image is missing; lookup ignores case', () => {
    const ini = songIniText({
      musicFile: 'a.mp3',
      backgroundImage: 'BG.JPG',
      backgroundAnims: ['100|ChgBgImg:LibImage=missing.jpg,Effect=NoTransition'],
      texts: ['la'],
      syncs: [1],
    })
    const s = songFromIni(ini, [
      { name: 'a.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33) },
      { name: 'bg.jpg', type: KfnEntryType.Image, data: new Uint8Array(4) },
    ])
    expect(s.backdrop.image.map((f) => f.value?.entry.name)).toEqual(['bg.jpg'])
    expect(s.warnings).toEqual(['Background image missing.jpg not found'])
  })
})

describe('video backgrounds', () => {
  const webm = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4)
  const mp4 = Uint8Array.from('\0\0\0\x18ftypisom', (c) => c.charCodeAt(0))
  const avi = Uint8Array.from('RIFF\0\0\0\0AVI LIST', (c) => c.charCodeAt(0))

  function withVideo(videoFile: string) {
    const ini = [
      '[General]',
      'Source=1,I,a.mp3',
      // Shifts lyrics and animations only; the video follows the music clock.
      'GlobalShift=100',
      'EffectCount=1',
      '[Eff1]',
      'ID=62',
      `VideoFile=${videoFile}`,
      'LoopVideo=1',
      'SeekTime=50',
    ].join('\r\n')
    return songFromIni(ini, [
      { name: 'a.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33) },
      { name: 'clip.avi', type: KfnEntryType.Video, data: webm },
    ])
  }

  it('sniffs the real media type, whatever the file name says', () => {
    expect(sniffMime({ name: 'x.avi', data: webm })).toBe('video/webm')
    expect(sniffMime({ name: 'x.avi', data: mp4 })).toBe('video/mp4')
    expect(sniffMime({ name: 'x.mp4', data: avi })).toBe('video/x-msvideo')
    expect(sniffMime({ name: 'x.bin', data: Uint8Array.of(0x49, 0x44, 0x33) })).toBe('audio/mpeg')
    expect(sniffMime({ name: 'x.mp3', data: new TextEncoder().encode('fLaC\0\0\0\x22') })).toBe('audio/flac')
    expect(sniffMime({ name: 'x.png', data: new Uint8Array(8) })).toBe('image/png')
  })

  it('picks the named video or, for UseMusicSource, the video entry', () => {
    expect(withVideo('clip.avi').video).toMatchObject({
      entry: { name: 'clip.avi' },
      loop: true,
      seekMs: 500,
    })
    expect(withVideo('UseMusicSource').video?.entry.name).toBe('clip.avi')
    const missing = withVideo('gone.avi')
    expect(missing.video).toBeNull()
    expect(missing.warnings).toEqual(['Video gone.avi not found'])
  })
})
