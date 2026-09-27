import type { Song } from './shared/protocol'

/** "Artist · Album" for browsing. */
export function songDetails(song: Song): string {
  return [song.artist || 'Unknown artist', song.album].filter(Boolean).join(' · ')
}

/** "Artist · 🎤 Singer" for queued songs. */
export function queuedDetails(song: Song, singer?: string): string {
  return [song.artist || 'Unknown artist', singer && `🎤 ${singer}`].filter(Boolean).join(' · ')
}

/** "1.0×", "1.1×", "1.75×" */
export function speedLabel(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}×`
}
