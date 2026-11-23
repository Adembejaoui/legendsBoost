import { ChevronRight } from 'lucide-react'
import { Link } from "@/i18n/navigation";
import { useTranslations } from 'next-intl'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const t = useTranslations('Service')
  return (
    <nav aria-label={t('breadcrumb')} className="mb-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {item.href ? (
                <Link href={item.href} className="transition-colors hover:text-zinc-300">
                  {item.label}
                </Link>
              ) : (
                <span className="text-zinc-400">{item.label}</span>
              )}
              {!isLast && <ChevronRight className="size-3.5 text-zinc-700" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}