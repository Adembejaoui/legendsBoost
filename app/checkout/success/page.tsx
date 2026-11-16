import { Suspense } from 'react'
import { CheckoutReturn } from '@/components/payment/CheckoutReturn'

export const dynamic = 'force-dynamic'

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div className="p-10 text-white">Loading…</div>}>
      <CheckoutReturn variant="success" />
    </Suspense>
  )
}
