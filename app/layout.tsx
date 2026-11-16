import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'
import { siteUrl } from '@/lib/site/url'
import { CookieNotice } from '@/components/layout/CookieNotice'

const DESCRIPTION =
  'Discover gaming services with transparent pricing, clear service rules, and support throughout your order.'

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: 'LegendsBoost — Play smarter. Reach your next level.',
    // Page titles already end with "— LegendsBoost"; the template must not add it twice.
    template: '%s',
  },
  description: DESCRIPTION,
  applicationName: 'LegendsBoost',
  // The only icon that exists is app/favicon.ico (served automatically).
  // The previous entries pointed at files that do not exist (404s).
  openGraph: {
    type: 'website',
    siteName: 'LegendsBoost',
    title: 'LegendsBoost',
    description: DESCRIPTION,
    images: ['/images/og.jpg'],
  },
  twitter: { card: 'summary_large_image', title: 'LegendsBoost', description: DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0B0C10',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
        <CookieNotice />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
