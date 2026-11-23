/** Public address of an uploaded blog image (safe for client code). */
export function blogImageUrl(id: string): string {
  return `/api/blog/images/${id}`;
}
