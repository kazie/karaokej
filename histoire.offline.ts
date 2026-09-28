import { globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Keeps the Histoire UI from reaching the internet: drops its Google Fonts
 * import and serves its Iconify icons from the local @iconify-json/* devDeps
 * instead of api.iconify.design / api.simplesvg.com / api.unisvg.com.
 */

const ICON_APIS = /https:\/\/api\.(?:iconify\.design|simplesvg\.com|unisvg\.com)/g
const FONT_IMPORT = /@import\s+url\(['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/g
const EXTERNAL = /https:\/\/(?:fonts\.googleapis\.com|api\.(?:iconify\.design|simplesvg\.com|unisvg\.com))/

interface IconSet {
  prefix: string
  icons: Record<string, unknown>
  aliases?: Record<string, { parent: string }>
  width?: number
  height?: number
}

const require = createRequire(import.meta.url)
const pkgDir = (pkg: string, from: string) =>
  dirname(require.resolve(`${pkg}/package.json`, { paths: [from] }))

/** Every file that can name an icon: the Histoire UI packages and our stories. */
function iconSources(root: string): string[] {
  const histoire = pkgDir('histoire', root)
  const app = pkgDir('@histoire/app', histoire)
  const controls = pkgDir('@histoire/controls', app)
  return [
    ...[histoire, app, controls].flatMap((dir) =>
      globSync('dist/**/*.js', { cwd: dir }).map((f) => join(dir, f)),
    ),
    ...globSync('src/**/*.story.*', { cwd: root }).map((f) => join(root, f)),
  ]
}

/** Subsets of the installed icon sets, holding just the icons in use. */
function collections(root: string, warn: (msg: string) => void): IconSet[] {
  const { devDependencies = {} } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const prefixes = Object.keys(devDependencies)
    .filter((dep) => dep.startsWith('@iconify-json/'))
    .map((dep) => dep.slice('@iconify-json/'.length))

  const used = Object.fromEntries(prefixes.map((p) => [p, new Set<string>()]))
  const pattern = new RegExp(`["'](${prefixes.join('|')}):([a-z0-9-]+)["']`, 'g')
  for (const file of iconSources(root)) {
    for (const [, prefix, name] of readFileSync(file, 'utf8').matchAll(pattern)) {
      used[prefix].add(name)
    }
  }

  return prefixes.map((prefix) => {
    // Parsed rather than require()d so the full set isn't kept in require.cache.
    const file = require.resolve(`@iconify-json/${prefix}/icons.json`, { paths: [root] })
    const set = JSON.parse(readFileSync(file, 'utf8')) as IconSet
    const icons: Record<string, unknown> = {}
    for (const name of used[prefix]) {
      const icon = set.icons[name] ?? set.icons[set.aliases?.[name]?.parent ?? '']
      if (icon) icons[name] = icon
      else warn(`histoire-offline: no local icon for ${prefix}:${name}`)
    }
    return { prefix, icons, width: set.width, height: set.height }
  })
}

export function histoireOffline(): Plugin {
  let root = process.cwd()
  let warn = console.warn
  let sets: IconSet[] | undefined
  return {
    name: 'histoire-offline',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
      warn = (msg) => config.logger.warn(msg)
    },
    transform(code, rawId) {
      const id = rawId.split('?')[0]
      let out: string
      if (/[\\/]@histoire[\\/]app[\\/]dist[\\/].*\.(css|pcss)$/.test(id)) {
        out = code.replace(FONT_IMPORT, '')
      } else if (/[\\/]@histoire[\\/]vendors[\\/]dist[\\/]client[\\/]b-iconify\.js$/.test(id)) {
        sets ??= collections(root, warn)
        const register = sets.map((c) => `addCollection(${JSON.stringify(c)});`)
        out = `${code.replace(ICON_APIS, '')}\n${register.join('\n')}\n`
      } else {
        return
      }
      // Fail loudly if a Histoire upgrade changes the format these regexes expect.
      if (EXTERNAL.test(out)) this.error(`histoire-offline: external URL left in ${id}`)
      return out
    },
  }
}
