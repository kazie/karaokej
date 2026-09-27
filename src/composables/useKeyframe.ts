import { computed, type ComputedRef } from 'vue'
import { valueAt, type Keyframe } from '../kfn/effects'

/**
 * Reads the current song position in ms. Components get this function rather
 * than the time itself: a prop that changes every frame would re-render the
 * whole component every frame, while reading the clock inside a computed only
 * re-runs that computed.
 */
export type Clock = () => number

/**
 * The keyframe of `frames` in effect now. `valueAt` returns the same object
 * until the next keyframe starts, so anything built from this only changes at a
 * song's keyframes, not on every animation frame.
 */
export function useKeyframe<T>(
  frames: () => readonly Keyframe<T>[],
  clock: Clock,
): ComputedRef<Keyframe<T> | undefined> {
  return computed(() => valueAt(frames(), clock()))
}
