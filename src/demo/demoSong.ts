import { buildKfn, concatBytes, latin1Bytes, songIniText } from '../kfn/buildKfn'
import { KfnEntryType } from '../kfn/parseKfn'
import { buildTimeline, splitSyllables } from '../kfn/timeline'

/** Neutral placeholder lyrics for stories and tests. */
export const DEMO_TEXTS = [
  'This is the de/mo song',
  'Each syl/la/ble lights up in time',
  '',
  'Lines scroll up/ward as they are sung',
  'The next line waits be/low',
  '',
  'Scan the code to add a song',
  'The end of the de/mo',
]

const encoder = new TextEncoder()

/** Pause (cs) after each blank line; the first one is an instrumental interlude. */
const DEMO_PAUSES: Record<number, number> = { 2: 800 }

/** Evenly paced sync marks in centiseconds. */
function demoSyncs(texts = DEMO_TEXTS, pauses = DEMO_PAUSES): number[] {
  const syncs: number[] = []
  let t = 150
  for (const [index, line] of texts.entries()) {
    const syllables = splitSyllables(line)
    if (!syllables.length) {
      t += pauses[index] ?? 100
      continue
    }
    for (const syl of syllables) {
      syncs.push(t)
      t += syl.endsWith(' ') ? 40 : 30
    }
    t += 60
  }
  return syncs
}

/** 16-bit mono WAV with a short tone at every sync mark. */
export function demoWav(syncs: number[], sampleRate = 22050): Uint8Array {
  const last = syncs[syncs.length - 1] ?? 0
  const samples = Math.ceil(((last + 200) / 100) * sampleRate)
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => new Uint8Array(buf).set(latin1Bytes(s), o)
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples * 2, true)

  const scale = [262, 294, 330, 392, 440, 523]
  const toneLength = Math.floor(sampleRate * 0.18)
  syncs.forEach((cs, i) => {
    const start = Math.floor((cs / 100) * sampleRate)
    const freq = scale[i % scale.length]!
    for (let n = 0; n < toneLength && start + n < samples; n++) {
      const envelope = Math.exp((-6 * n) / toneLength)
      const sample = Math.sin((2 * Math.PI * freq * n) / sampleRate) * envelope * 0.25
      v.setInt16(44 + (start + n) * 2, sample * 0x7fff, true)
    }
  })
  return new Uint8Array(buf)
}

const svg = (
  from: string,
  to: string,
  circle: string,
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/>
<circle ${circle} fill="#f9f8f4" opacity="0.15"/>
</svg>`

/** Three backgrounds the demo switches between (crossfade, then an instant cut). */
const DEMO_BACKGROUNDS = {
  'demo.svg': svg('#1b2a4a', '#6a2c70', 'cx="320" cy="70" r="40"'),
  'demo2.svg': svg('#0f3b3a', '#2c6a4a', 'cx="80" cy="220" r="60"'),
  'demo3.svg': svg('#4a1b1b', '#70502c', 'cx="200" cy="150" r="90"'),
}

/** The music file name has an "Ö" and is written in windows-1252 in Song.ini, like some real files. */
export const DEMO_MUSIC_FILE = 'Demo Ö.wav'

/** Encode Song.ini as UTF-8, except the `Source=` line, which uses windows-1252. */
function mixedEncoding(ini: string): Uint8Array {
  return concatBytes(
    ini.split('\n').map((line, i, all) => {
      const text = i < all.length - 1 ? `${line}\n` : line
      return line.startsWith('Source=') ? latin1Bytes(text) : encoder.encode(text)
    }),
  )
}

/** A complete synthetic KFN file for stories and manual testing. */
export function makeDemoKfn(options: { encrypted?: boolean } = {}): Uint8Array {
  const syncs = demoSyncs()
  // Line start times in cs, for timing the demo's effects.
  const lineStartCs = (i: number) => buildTimeline({ texts: DEMO_TEXTS, syncs }).lines[i]!.start / 10
  const verse2 = lineStartCs(3)
  const verse3 = lineStartCs(6)
  const lastLine = lineStartCs(7)
  const ini = songIniText({
    title: 'Demo Song',
    artist: 'Karaokej',
    album: 'Demo',
    musicFile: DEMO_MUSIC_FILE,
    backgroundImage: 'demo.svg',
    texts: DEMO_TEXTS,
    syncs,
    activeColor: '#C7E55CFF',
    inactiveColor: '#F9F8F4FF',
    frameColor: '#010101FF',
    inactiveFrameColor: '#1E4D42FF',
    backgroundAnims: [
      `${verse2 - 150}|ChgBgImg:LibImage=demo2.svg,Effect=AlphaBlending,TransitionTime=150,TransType=Smooth`,
      `${verse3}|ChgBgImg:LibImage=demo3.svg,Effect=NoTransition,TransitionTime=0,TransType=Linear`,
      `${verse3}|ChgFloatDepth:TargetFloat=-2,TransTime=10,TransType=Linear`,
      `${verse3 + 40}|ChgFloatDepth:TargetFloat=0,TransTime=30,TransType=Smooth`,
    ],
    lyricsAnims: [
      `${verse2}|ChgColActiveColor:TargetColor=#FFB347FF,FadeTime=100`,
      `${lastLine}|ChgSelTextEffect:Trajectory=LittleShake*1.000000*1.000000*1.000000*1.000000`,
    ],
  })
  return buildKfn({
    header: { TITL: 'Demo Song', ARTS: 'Karaokej', SORC: `1,I,${DEMO_MUSIC_FILE}` },
    key: options.encrypted ? encoder.encode('0123456789abcdef') : undefined,
    entries: [
      { name: DEMO_MUSIC_FILE, type: KfnEntryType.Music, data: demoWav(syncs) },
      ...Object.entries(DEMO_BACKGROUNDS).map(([name, content]) => ({
        name,
        type: KfnEntryType.Image,
        data: encoder.encode(content),
      })),
      { name: 'Song.ini', type: KfnEntryType.SongIni, data: mixedEncoding(ini), encrypt: options.encrypted },
    ],
  })
}
