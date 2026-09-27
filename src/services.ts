import { inject, provide, type InjectionKey } from 'vue'
import { fetchSongFile, getCategories, getInfo, searchSongs } from './api'
import { useSession } from './composables/useSession'

export type Session = ReturnType<typeof useSession>

/**
 * Everything the views need from the server. The app uses the real
 * implementations; stories provide an in-memory fake (see src/demo/fakeBackend.ts).
 */
export interface KaraokeServices {
  connect: typeof useSession
  searchSongs: typeof searchSongs
  getCategories: typeof getCategories
  getInfo: typeof getInfo
  fetchSongFile: typeof fetchSongFile
}

const realServices: KaraokeServices = {
  connect: useSession,
  searchSongs,
  getCategories,
  getInfo,
  fetchSongFile,
}

const KEY: InjectionKey<KaraokeServices> = Symbol('karaoke-services')

export const provideServices = (services: KaraokeServices) => provide(KEY, services)

export const useServices = (): KaraokeServices => inject(KEY, realServices)
