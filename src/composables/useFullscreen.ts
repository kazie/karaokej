import { onBeforeUnmount, onMounted, ref } from 'vue'

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void>
}
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

/** Fullscreen API with the WebKit prefix fallback (older Safari / iPadOS). */
export function useFullscreen() {
  const doc = document as WebkitDocument
  const supported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
  const active = ref(false)

  const update = () => (active.value = !!(doc.fullscreenElement ?? doc.webkitFullscreenElement))

  async function enter(): Promise<void> {
    const el = document.documentElement as WebkitElement
    try {
      await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())
    } catch {
      /* denied or unsupported; stay windowed */
    }
  }

  async function exit(): Promise<void> {
    try {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
    } catch {
      /* already windowed */
    }
  }

  const toggle = () => (active.value ? exit() : enter())

  onMounted(() => {
    update()
    document.addEventListener('fullscreenchange', update)
    document.addEventListener('webkitfullscreenchange', update)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', update)
    document.removeEventListener('webkitfullscreenchange', update)
  })

  return { supported, active, enter, exit, toggle }
}
