import { describe, expect, it } from 'vitest'
import { songIniText } from '../src/kfn/buildKfn'
import { kfnColor, parseAnimation, parseIni, parseSongIni } from '../src/kfn/parseSongIni'

describe('parseIni', () => {
  it('parses sections and keeps value whitespace', () => {
    const ini = parseIni('[A]\r\nx=1\r\n; comment\r\ny= padded \r\n\r\n[B]\nz=a=b')
    expect(ini.get('A')).toEqual(
      new Map([
        ['x', '1'],
        ['y', ' padded '],
      ]),
    )
    expect(ini.get('B')?.get('z')).toBe('a=b')
  })
})

describe('kfnColor', () => {
  it('converts #RRGGBBAA and #RRGGBB', () => {
    expect(kfnColor('#1F6AB6FF', 'x')).toBe('rgb(31 106 182)')
    expect(kfnColor('#00000080', 'x')).toBe('rgb(0 0 0 / 0.502)')
    expect(kfnColor('#FFFFFF', 'x')).toBe('rgb(255 255 255)')
    expect(kfnColor('bogus', 'fallback')).toBe('fallback')
    expect(kfnColor(undefined, 'fallback')).toBe('fallback')
  })
})

describe('parseSongIni', () => {
  const text = songIniText({
    title: 'Song',
    artist: 'Singer',
    musicFile: 'a, b.mp3',
    backgroundImage: 'bg.jpg',
    texts: ['A/ka/i ho/p/pe', '', 'Ki/i/ro'],
    syncs: Array.from({ length: 45 }, (_, i) => 100 + i * 10),
    font: 'Verdana*24',
  })
  const song = parseSongIni(text)

  it('reads general metadata and the music source', () => {
    expect(song.title).toBe('Song')
    expect(song.artist).toBe('Singer')
    expect(song.musicFile).toBe('a, b.mp3')
    expect(song.globalShift).toBe(0)
  })

  it('reads the background effect', () => {
    expect(song.effects[0]).toMatchObject({ kind: 'background', image: 'bg.jpg', enabled: true })
  })

  it('reads lyrics, syncs across multiple Sync lines, and style', () => {
    const lyrics = song.effects[1]!
    if (lyrics.kind !== 'lyrics') throw new Error('expected lyrics')
    expect(lyrics.texts).toEqual(['A/ka/i ho/p/pe', '', 'Ki/i/ro'])
    expect(lyrics.syncs).toHaveLength(45)
    expect(lyrics.syncs[44]).toBe(540)
    expect(lyrics.style).toMatchObject({
      fontFamily: 'Verdana',
      fontSize: 24,
      alignment: 'center',
      trajectory: 'PlainBottomToTop',
      activeColor: 'rgb(31 106 182)',
    })
  })

  it('treats Enabled=0 as disabled and unknown effects as other', () => {
    const s = parseSongIni('[General]\nEffectCount=1\n[Eff1]\nID=7\nEnabled=0')
    expect(s.effects).toEqual([expect.objectContaining({ kind: 'other', id: 7, enabled: false })])
    expect(s.musicFile).toBeNull()
  })
})

describe('animations', () => {
  it('parses times, several actions, and file names with commas', () => {
    expect(
      parseAnimation(
        '8381|ChgColColor:TargetColor=#FFFFFF,FadeTime=0|ChgBgImg:LibImage=Me, myself, and I.jpg,Effect=AlphaBlending,TransitionTime=19,TransType=Smooth',
      ),
    ).toEqual({
      timeCs: 8381,
      actions: [
        { type: 'ChgColColor', params: { TargetColor: '#FFFFFF', FadeTime: '0' } },
        {
          type: 'ChgBgImg',
          params: {
            LibImage: 'Me, myself, and I.jpg',
            Effect: 'AlphaBlending',
            TransitionTime: '19',
            TransType: 'Smooth',
          },
        },
      ],
    })
    expect(parseAnimation('not a number|X:y=1')).toBeNull()
  })

  it('reads NbAnim animations, base offsets and video effects', () => {
    const song = parseSongIni(
      [
        '[General]',
        'EffectCount=2',
        '[Eff1]',
        'ID=51',
        'LibImage=a.jpg',
        'OffsetX=-10',
        'Depth=-1',
        'ImageColor=#FFFFFF80',
        'NbAnim=2',
        'Anim1=300|ChgBgImg:LibImage=c.jpg,Effect=NoTransition,TransitionTime=0',
        'Anim0=100|ChgBgImg:LibImage=b.jpg,Effect=Fade,TransitionTime=20',
        '[Eff2]',
        'ID=62',
        'VideoFile=UseMusicSource',
        'LoopVideo=1',
        'SeekTime=0',
        'DisplayLastFrame=0',
      ].join('\n'),
    )
    const bg = song.effects[0]!
    expect(bg).toMatchObject({ kind: 'background', offsetX: -10, depth: -1, imageColor: '#FFFFFF80' })
    expect(bg.animations.map((a) => a.timeCs)).toEqual([100, 300])
    expect(song.effects[1]).toMatchObject({
      kind: 'video',
      videoFile: 'UseMusicSource',
      loop: true,
      seekCs: 0,
    })
  })
})
