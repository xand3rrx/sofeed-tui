import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from './api'

export function useRemote<T>(loader: (signal: AbortSignal) => Promise<T>, dependencies: unknown[]) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce(x => x + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    loader(controller.signal).then(setData).catch(error => {
      if (error?.name !== 'AbortError') setError(errorMessage(error))
    }).finally(() => setLoading(false))
    return () => controller.abort()
    // dependencies are intentionally supplied by callers as stable primitives
  }, [...dependencies, nonce])
  return { data, error, loading, reload, setData }
}
