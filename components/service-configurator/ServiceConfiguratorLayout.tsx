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
      <div className="mb-3">{header}</div>
      <div className="mb-4">{tabs}</div>
      <div className="grid gap-4 lg:grid-cols-[60%_1fr] lg:gap-6">
        <div className="space-y-3">{left}</div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-3">{right}</div>
        </aside>
      </div>
      {footer ? <div className="mt-5 lg:w-[60%]">{footer}</div> : null}
    </div>
  )
}
