import type { ReactNode } from 'react'

/**
 * The real root layout (with <html lang>) is app/[locale]/layout.tsx, one
 * per language. This one only exists for the pages outside a language
 * (the global 404 below and global-error).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}
