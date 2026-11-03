'use client'

import { useState } from 'react'

interface ImageFallbackProps {
  src: string | undefined
  alt: string
  className?: string
  fallback: React.ReactNode
}

export function ImageFallback({ src, alt, className, fallback }: ImageFallbackProps) {
  const [broken, setBroken] = useState(false)

  if (!src) {
    return <span className={className}>{fallback}</span>
  }

  return (
    <span className="inline-flex items-center justify-center">
      {!broken && (
        <img
          src={src}
          alt={alt}
          className={className}
          onError={() => setBroken(true)}
          loading="lazy"
          decoding="async"
        />
      )}
      {broken && <span className={className}>{fallback}</span>}
    </span>
  )
}
