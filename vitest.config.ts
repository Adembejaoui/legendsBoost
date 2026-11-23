import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts'],
    // next-intl imports "next/navigation" without an extension, which plain
    // Node cannot resolve; let Vite process it like app code.
    server: { deps: { inline: ['next-intl'] } },
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
    },
  },
})