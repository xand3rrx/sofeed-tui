import { useInput } from 'ink'
import React, { createContext, useContext } from 'react'

const ScreenInputContext = createContext(true)

export function ScreenInputBoundary({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <ScreenInputContext.Provider value={active}>{children}</ScreenInputContext.Provider>
}

export function useScreenActive() {
  return useContext(ScreenInputContext)
}

export function normalizeShiftInput(input: string, key: { shift?: boolean }) {
  if (key.shift && input.length === 1 && input >= 'a' && input <= 'z') return input.toUpperCase()
  return input
}

export function useScreenInput(handler: Parameters<typeof useInput>[0]) {
  useInput((input, key) => handler(normalizeShiftInput(input, key), key), { isActive: useScreenActive() })
}
