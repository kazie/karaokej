import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  libraryRoot: string
  dbPath: string
  port: number
  host: string | undefined
  publicUrl: string | null
  rescanMinutes: number
  staticDir: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const library = env.KARAOKEJ_LIBRARY
  if (!library) throw new Error('KARAOKEJ_LIBRARY must point at the folder containing your .kfn files')
  const here = dirname(fileURLToPath(import.meta.url))
  return {
    libraryRoot: resolve(library),
    dbPath: resolve(env.KARAOKEJ_DB ?? 'data/karaokej.db'),
    port: Number(env.PORT ?? 3000),
    // Unset: Node listens on all interfaces, IPv6 and IPv4 where available.
    host: env.HOST || undefined,
    publicUrl: env.KARAOKEJ_PUBLIC_URL?.replace(/\/+$/, '') || null,
    rescanMinutes: Number(env.KARAOKEJ_RESCAN_MINUTES ?? 0),
    staticDir: resolve(env.KARAOKEJ_STATIC_DIR ?? join(here, '..', 'dist')),
  }
}
