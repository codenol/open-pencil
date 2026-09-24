import { resolve } from 'node:path'

import { normalizePath, type ServerOptions } from 'vite'

const WATCHED_MARKDOWN_ROOTS = ['/src/', '/packages/core/src/', '/packages/vue/src/']

function ignoreMarkdownOutsideSource(path: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized.endsWith('.md')) return false
  return !WATCHED_MARKDOWN_ROOTS.some((root) => normalized.includes(root))
}

export const WATCH_IGNORED = [
  '**/desktop/**',
  '**/packages/cli/**',
  '**/packages/mcp/**',
  '**/packages/docs/**',
  '**/tests/**',
  '**/.github/**',
  '**/.pi/**',
  ignoreMarkdownOutsideSource
]

export function createDevServerOptions(host: string | undefined, rootDir: string): ServerOptions {
  return {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Dev-прокси для хранилища документов: редактор ходит на /store того же
    // домена, а локально рядом поднят tools/storage/server.mjs (порт 7802).
    // Адрес можно переопределить: OPENPENCIL_STORE_TARGET=http://host:port.
    proxy: {
      '/store': {
        target: process.env.OPENPENCIL_STORE_TARGET ?? 'http://127.0.0.1:7802',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/store/, '')
      }
    },
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      // Ignore nested checkouts, not an active checkout whose own path contains .worktrees.
      ignored: [...WATCH_IGNORED, `${normalizePath(resolve(rootDir, '.worktrees'))}/**`]
    }
  }
}
