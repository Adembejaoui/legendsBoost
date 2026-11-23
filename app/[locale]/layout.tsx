import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import '../globals.css'
import { Providers } from '@/components/providers'
import { siteUrl } from '@/lib/site/url'
import { CookieNotice } from '@/components/layout/CookieNotice'
import { routing, textDirection } from '@/i18n/routing'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: 'Site' })
  const description = t('description')
  return {
    metadataBase: siteUrl(),
    title: {
      default: t('defaultTitle'),
      // Page titles already end with "— LegendsBoost"; the template must not add it twice.
      template: '%s',
    },
    description,
    applicationName: 'LegendsBoost',
    // The only icon that exists is app/favicon.ico (served automatically).
    openGraph: {
      type: 'website',
      siteName: 'LegendsBoost',
      title: 'LegendsBoost',
      description,
      images: ['/images/og.jpg'],
      locale,
    },
    twitter: { card: 'summary_large_image', title: 'LegendsBoost', description },
    formatDetection: { telephone: false, email: false, address: false },
  }
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0B0C10',
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  return (
    <html lang={locale} dir={textDirection(locale)}>
      <body className="antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
          <CookieNotice />
        </NextIntlClientProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
