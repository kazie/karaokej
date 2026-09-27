import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KfnEntryType, parseKfn } from '../src/kfn/parseKfn'
import { loadSong, sniffMime } from '../src/kfn/song'

// Real KFN files are never committed. Put some in examples/ to run this locally.
const dir = join(import.meta.dirname, '..', 'examples')
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.kfn')) : []

if (files.length === 0) {
  it.skip('no KFN files in examples/', () => {})
}

describe.each(files)('example %s', (file) => {
  const kfn = parseKfn(readFileSync(join(dir, file)))
  const song = loadSong(kfn)

  it('has metadata and a Song.ini', () => {
    expect(kfn.meta.title).not.toBe('')
    expect(kfn.entries.some((e) => e.type === KfnEntryType.SongIni)).toBe(true)
  })

  // Real AVI music (e.g. "Silent Hill 2 - Dog Ending") needs server-side conversion; not supported yet.
  const needsConversion = !!song.music && sniffMime(song.music) === 'video/x-msvideo'
  it.skipIf(needsConversion)('has music in a browser-playable format (MP3, MP4 or WebM)', () => {
    expect(['audio/mpeg', 'video/mp4', 'video/webm']).toContain(sniffMime(song.music!))
  })

  it('decodes all Song.ini text without mojibake', () => {
    const text = [...song.ini.sections.values()].flatMap((section) => [...section.values()]).join('\n')
    expect(text).not.toMatch(/Ã[\u0080-\u00bf]/)
  })

  it('has one sync mark per syllable', () => {
    expect(song.warnings).toEqual([])
    expect(song.lyrics.length).toBeGreaterThan(0)
  })
})

const ulf = files.find((f) => f.startsWith('Ulf Lundell'))
describe.skipIf(!ulf)('Ulf Lundell - Öppna Landskap (mixed encoding, 26 background changes)', () => {
  // Loaded lazily: a skipped describe still runs its body while collecting tests.
  let loaded: ReturnType<typeof loadSong> | undefined
  const song = () => (loaded ??= loadSong(parseKfn(readFileSync(join(dir, ulf!)))))

  it('decodes the UTF-8 title and lyrics next to windows-1252 lines', () => {
    expect(song().title).toBe('Öppna Landskap')
    expect(
      song()
        .lyrics[0]!.timeline.lines[0]!.syllables.map((s) => s.text)
        .join(''),
    ).toBe('Jag trivs bäst i öppna landskap')
    expect(song().warnings).toEqual([])
  })

  it('resolves every background change to a picture', () => {
    const image = song().backdrop.image
    expect(image).toHaveLength(26)
    expect(image.every((f) => f.value !== null)).toBe(true)
    expect(image.some((f) => f.value?.name === 'augusti_Kräftskiva_Fest-_porträtt_ica1.jpg')).toBe(true)
    expect(image[1]!.startMs).toBe(68_610)
  })
})
