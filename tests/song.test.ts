import { describe, expect, it } from 'vitest'
import { DEMO_MUSIC_FILE, DEMO_TEXTS, makeDemoKfn, makeDuetDemoKfn } from '../src/demo/demoSong'
import { buildKfn, songIniText } from '../src/kfn/buildKfn'
import { KfnEntryType, parseKfn } from '../src/kfn/parseKfn'
import { loadSong, mimeType, sniffMime } from '../src/kfn/song'
import { buildGaps, lineWindows, shownAt } from '../src/kfn/timeline'

describe('loadSong', () => {
  it.each([false, true])('loads the demo song (encrypted: %s)', (encrypted) => {
    const song = loadSong(parseKfn(makeDemoKfn({ encrypted })))
    expect(song.title).toBe('Demo Song')
    expect(song.music?.name).toBe(DEMO_MUSIC_FILE)
    expect(song.backdrop.image[0]?.value?.name).toBe('demo.svg')
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
    const kfn = buildKfn({
      entries: [
        { name: 'x.mp3', type: KfnEntryType.Music, data: new Uint8Array(4) },
        { name: 'Song.ini', type: KfnEntryType.SongIni, data: new TextEncoder().encode(ini) },
      ],
    })
    const song = loadSong(parseKfn(kfn))
    expect(song.music?.name).toBe('x.mp3')
    expect(song.warnings[0]).toMatch(/gone\.mp3 not found/)
  })

  it('requires a Song.ini', () => {
    expect(() => loadSong(parseKfn(buildKfn({ entries: [] })))).toThrow(/Song\.ini/)
  })
})

describe('mimeType', () => {
  it('maps common extensions', () => {
    expect(mimeType('a.MP3')).toBe('audio/mpeg')
    expect(mimeType('b.jpg')).toBe('image/jpeg')
    expect(mimeType('noext')).toBe('application/octet-stream')
  })
})

describe('timed effects', () => {
  const song = loadSong(parseKfn(makeDemoKfn()))

  it('resolves background image changes with their transitions', () => {
    const image = song.backdrop.image
    expect(image.map((f) => [f.value?.name, f.transitionMs])).toEqual([
      ['demo.svg', 0],
      ['demo2.svg', 1500], // AlphaBlending, 150 cs
      ['demo3.svg', 0], // NoTransition
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
  })

  it('keeps the previous picture and warns when an image is missing; lookup ignores case', () => {
    const ini = songIniText({
      musicFile: 'a.mp3',
      backgroundImage: 'BG.JPG',
      backgroundAnims: ['100|ChgBgImg:LibImage=missing.jpg,Effect=NoTransition'],
      texts: ['la'],
      syncs: [1],
    })
    const kfn = buildKfn({
      entries: [
        { name: 'a.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33) },
        { name: 'bg.jpg', type: KfnEntryType.Image, data: new Uint8Array(4) },
        { name: 'Song.ini', type: KfnEntryType.SongIni, data: new TextEncoder().encode(ini) },
      ],
    })
    const s = loadSong(parseKfn(kfn))
    expect(s.backdrop.image.map((f) => f.value?.name)).toEqual(['bg.jpg'])
    expect(s.warnings).toEqual(['Background image missing.jpg not found'])
  })
})

describe('video backgrounds', () => {
  const enc = new TextEncoder()
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
    return loadSong(
      parseKfn(
        buildKfn({
          entries: [
            { name: 'a.mp3', type: KfnEntryType.Music, data: Uint8Array.of(0x49, 0x44, 0x33) },
            { name: 'clip.avi', type: KfnEntryType.Video, data: webm },
            { name: 'Song.ini', type: KfnEntryType.SongIni, data: enc.encode(ini) },
          ],
        }),
      ),
    )
  }

  it('sniffs the real media type, whatever the file name says', () => {
    expect(sniffMime({ name: 'x.avi', data: webm })).toBe('video/webm')
    expect(sniffMime({ name: 'x.avi', data: mp4 })).toBe('video/mp4')
    expect(sniffMime({ name: 'x.mp4', data: avi })).toBe('video/x-msvideo')
    expect(sniffMime({ name: 'x.bin', data: Uint8Array.of(0x49, 0x44, 0x33) })).toBe('audio/mpeg')
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
