import type { CategoryCount } from './protocol'

/**
 * The top-level folder of a library path, and the folder below it. Files
 * directly in a folder have `''` for the missing level; deeper folders count
 * as their second-level folder.
 */
export function folderOf(path: string): { category: string; subcategory: string } {
  const parts = path.split('/').slice(0, -1)
  return { category: parts[0] ?? '', subcategory: parts[1] ?? '' }
}

export interface FolderCount {
  category: string
  subcategory: string
  count: number
}

/**
 * Swedish order (å, ä, ö after z), ignoring case, the same on the server and in
 * every browser. Song lists are sorted by SQLite (`COLLATE NOCASE`) instead.
 */
const byName = new Intl.Collator('sv', { sensitivity: 'accent' }).compare

/**
 * Song counts per folder pair, as the category list: sorted by name, and with
 * subfolder counts only for categories that have subfolders.
 */
export function groupCategories(rows: readonly FolderCount[]): CategoryCount[] {
  const byCategory = new Map<string, CategoryCount>()
  for (const { category, subcategory, count } of rows) {
    const c = byCategory.get(category) ?? { category, count: 0, subcategories: [] }
    byCategory.set(category, c)
    c.count += count
    c.subcategories.push({ subcategory, count })
  }
  for (const c of byCategory.values()) {
    // All songs directly in the folder: nothing to narrow down to.
    if (c.subcategories.some((s) => s.subcategory))
      c.subcategories.sort((a, b) => byName(a.subcategory, b.subcategory))
    else c.subcategories = []
  }
  return [...byCategory.values()].sort((a, b) => byName(a.category, b.category))
}
