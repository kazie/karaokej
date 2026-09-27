import { readonly, ref, watchEffect, type Ref } from 'vue'

/** An object URL for `source`, revoked when the source changes or the component unmounts. */
export function useObjectUrl(source: () => Blob | null | undefined): Readonly<Ref<string | undefined>> {
  const url = ref<string>()
  watchEffect((onCleanup) => {
    const blob = source()
    const created = blob ? URL.createObjectURL(blob) : undefined
    url.value = created
    onCleanup(() => created && URL.revokeObjectURL(created))
  })
  return readonly(url)
}
