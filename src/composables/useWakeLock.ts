import { onBeforeUnmount } from 'vue'

/** Keep the display awake (phones and laptops used as the karaoke screen). */
export function useWakeLock() {
  let lock: WakeLockSentinel | null = null
  let wanted = false

  async function acquire(): Promise<void> {
    wanted = true
    if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    try {
      lock = await navigator.wakeLock.request('screen')
      lock.addEventListener('release', () => (lock = null))
    } catch {
      /* not allowed (e.g. battery saver); the screen may dim */
    }
  }

  const onVisibility = () => {
    if (wanted) acquire()
  }
  document.addEventListener('visibilitychange', onVisibility)
  onBeforeUnmount(() => {
    wanted = false
    document.removeEventListener('visibilitychange', onVisibility)
    lock?.release()
  })

  return { acquire }
}
