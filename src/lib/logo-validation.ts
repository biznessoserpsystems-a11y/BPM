// Explicit allowlist rather than a broad "data:image/" prefix check —
// that broad check would also accept "data:image/svg+xml", and an SVG
// can contain embedded <script> tags. Browsers generally sandbox script
// execution for SVGs loaded via an <img> tag (which is how every logo
// in this app is rendered), so this likely isn't actually exploitable
// as currently used — but that's a property of how the value happens to
// be consumed today, not a guarantee the data itself is safe, and it's
// a cheap, defensible fix either way rather than relying on that holding
// true forever.
const SAFE_IMAGE_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/gif', 'data:image/webp'];

export function isSafeImageDataUri(value: string): boolean {
  return SAFE_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix));
}
