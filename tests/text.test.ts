import { describe, expect, it } from 'vitest'
import { concatBytes, latin1Bytes } from '../src/kfn/buildKfn'
import { decodeText, decodeTextByLine } from '../src/kfn/text'

describe('decodeText', () => {
  it('decodes UTF-8 and strips a BOM', () => {
    expect(decodeText(new TextEncoder().encode('﻿Sjung ikväll'))).toBe('Sjung ikväll')
  })

  it('falls back to windows-1252 for invalid UTF-8', () => {
    expect(decodeText(Uint8Array.of(0x6b, 0x76, 0xe4, 0x6c, 0x6c, 0x80))).toBe('kväll€')
  })
})

describe('decodeTextByLine', () => {
  const enc = new TextEncoder()

  it('decodes UTF-8 and windows-1252 lines of the same file independently', () => {
    const bytes = concatBytes([
      enc.encode('﻿Title=Öppna Landskap\r\n'),
      latin1Bytes('Source=1,I,Öppna Landskap.mp3\r\n'),
      enc.encode('Text0=Jag trivs bä/st'),
    ])
    expect(decodeTextByLine(bytes).split('\n')).toEqual([
      'Title=Öppna Landskap\r',
      'Source=1,I,Öppna Landskap.mp3\r',
      'Text0=Jag trivs bä/st',
    ])
  })

  it('keeps empty lines', () => {
    expect(decodeTextByLine(enc.encode('a\n\nb\n'))).toBe('a\n\nb\n')
  })
})
