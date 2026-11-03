import { Suspense } from 'react'
import { PaymentPageClient } from '@/components/payment/PaymentPageClient'

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="p-10 text-white">Loading...</div>}>
      <PaymentPageClient />
    </Suspense>
  )
}