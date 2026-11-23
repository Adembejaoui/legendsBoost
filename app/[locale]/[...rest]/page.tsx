import { notFound } from 'next/navigation'

/** Unknown address inside a language: show that language's 404 page. */
export default function CatchAll() {
  notFound()
}
