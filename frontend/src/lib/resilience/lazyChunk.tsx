import { createElement, lazy, type ComponentProps, type ComponentType } from 'react'

// `any` is deliberate: the props are recovered from T by ComponentProps below, this only constrains "some component".
// oxlint-disable-next-line typescript/no-explicit-any
type AnyComponent = ComponentType<any>

export interface RetryableLazy<T extends AnyComponent> {
  (props: ComponentProps<T>): ReturnType<typeof createElement>
  /** Forget a failed import so the next render fetches the chunk again (React.lazy caches the rejection forever). */
  reset: () => void
}

/** `React.lazy` whose failure can be retried, for dropped wifi and stale deploys. */
export function lazyChunk<T extends AnyComponent>(load: () => Promise<{ default: T }>): RetryableLazy<T> {
  let Inner = lazy(load)
  const wrapper = (props: ComponentProps<T>) => createElement(Inner as AnyComponent, props)
  return Object.assign(wrapper, {
    reset: () => {
      Inner = lazy(load)
    },
  })
}
