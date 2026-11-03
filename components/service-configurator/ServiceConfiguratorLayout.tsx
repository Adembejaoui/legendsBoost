'use client'

import type { ReactNode } from 'react'

interface ServiceConfiguratorLayoutProps {
  header: ReactNode
  tabs: ReactNode
  left: ReactNode
  right: ReactNode
  footer?: ReactNode
}

export function ServiceConfiguratorLayout({
  header,
  tabs,
  left,
  right,
  footer,
}: ServiceConfiguratorLayoutProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mb-6">{header}</div>
      <div className="mb-8">{tabs}</div>
      <div className="grid gap-6 lg:grid-cols-[60%_1fr] lg:gap-8">
        <div className="space-y-6">{left}</div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-6">{right}</div>
        </aside>
      </div>
      {footer ? <div className="mt-8">{footer}</div> : null}
    </div>
  )
}
