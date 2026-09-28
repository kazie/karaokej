import { describe, expect, it } from 'vitest'
import { folderOf, groupCategories } from '../src/shared/folders'

describe('folderOf', () => {
  it('takes the top folder and the one below it', () => {
    expect(folderOf('root.kfn')).toEqual({ category: '', subcategory: '' })
    expect(folderOf('Anime/x.kfn')).toEqual({ category: 'Anime', subcategory: '' })
    expect(folderOf('Anime/Ghibli/x.kfn')).toEqual({ category: 'Anime', subcategory: 'Ghibli' })
    expect(folderOf('Anime/Ghibli/Movies/x.kfn')).toEqual({ category: 'Anime', subcategory: 'Ghibli' })
  })
})

describe('groupCategories', () => {
  it('nests and sorts folder counts, ignoring case', () => {
    expect(
      groupCategories([
        { category: 'pop', subcategory: '', count: 2 },
        { category: 'Anime', subcategory: 'shows', count: 1 },
        { category: 'Anime', subcategory: '', count: 3 },
        { category: 'Anime', subcategory: 'Ghibli', count: 4 },
      ]),
    ).toEqual([
      {
        category: 'Anime',
        count: 8,
        subcategories: [
          { subcategory: '', count: 3 },
          { subcategory: 'Ghibli', count: 4 },
          { subcategory: 'shows', count: 1 },
        ],
      },
      // Only songs directly in the folder: no subfolders to pick from.
      { category: 'pop', count: 2, subcategories: [] },
    ])
  })

  it('sorts in Swedish order: å, ä and ö come after z', () => {
    const names = ['Övrigt', 'anime', 'Ägg', 'Zelda', 'Åsa', 'Oz']
    const grouped = groupCategories(names.map((category) => ({ category, subcategory: '', count: 1 })))
    expect(grouped.map((c) => c.category)).toEqual(['anime', 'Oz', 'Zelda', 'Åsa', 'Ägg', 'Övrigt'])
  })

  it('keeps folders that differ only in case apart, whatever order the rows come in', () => {
    const grouped = groupCategories([
      { category: 'Anime', subcategory: 'Ghibli', count: 1 },
      { category: 'anime', subcategory: 'Shows', count: 1 },
      { category: 'Anime', subcategory: 'Zelda', count: 1 },
    ])
    expect(Object.fromEntries(grouped.map((c) => [c.category, c.count]))).toEqual({ Anime: 2, anime: 1 })
    expect(grouped).toHaveLength(2)
  })
})
