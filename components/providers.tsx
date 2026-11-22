'use client'

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'
import { SiteAlerts } from '@/components/realtime/SiteAlerts'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <SiteAlerts />
    </SessionProvider>
  )
}
