#!/usr/bin/env bun
import { render } from 'ink'
import React from 'react'
import { App } from './app'
import { loadConfig, normalizeBaseUrl } from './config'
import { THEME_NAMES } from './theme'
import type { ThemeName } from './types'

export const VERSION = '1.0.0'
const HELP =
  `sofeed ${VERSION}\n\nUsage: sofeed [options]\n\n  --url <origin>              Sofeed instance (default https://sofeed.cc)\n  --theme <scheme>            Color scheme: ${THEME_NAMES.join('|')}\n  --help                      Show help\n  --version                   Show version\n\nEnvironment: SOFEED_URL, SOFEED_TOKEN, SOFEED_THEME, NO_COLOR`

export function parseArgs(args: string[]) {
  const result: { url?: string; theme?: ThemeName; help?: boolean; version?: boolean } = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') result.help = true
    else if (arg === '--version' || arg === '-v') result.version = true
    else if (arg === '--url') {
      if (!args[++index]) throw new Error('--url requires a value')
      result.url = normalizeBaseUrl(args[index])
    }
    else if (arg === '--theme') {
      const theme = args[++index]
      if (!THEME_NAMES.includes(theme as ThemeName)) {
        throw new Error(`--theme must be one of: ${THEME_NAMES.join(', ')}`)
      }
      result.theme = theme as ThemeName
    }
    else throw new Error(`Unknown option: ${arg}`)
  }
  return result
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 2
    return
  }
  if (args.help) return console.log(HELP)
  if (args.version) return console.log(VERSION)
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('sofeed requires an interactive terminal')
    process.exitCode = 1
    return
  }
  const config = await loadConfig()
  if (args.url) config.baseUrl = args.url
  if (args.theme) config.theme = args.theme
  const instance = render(<App initialConfig={config} />, {
    exitOnCtrlC: true,
    kittyKeyboard: { mode: 'enabled' },
  })
  await instance.waitUntilExit()
}

if (import.meta.main) await main()
