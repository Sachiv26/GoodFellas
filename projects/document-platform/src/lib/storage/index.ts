/**
 * Storage abstraction for private document storage.
 *
 * Documents are NEVER served from /public. The storage layer supports:
 *   - local filesystem (development)
 *   - S3-compatible private bucket (production, future)
 *
 * Access is authenticated (short-lived signed URLs or direct stream).
 * A customer may only access their own documents.
 */
export {}
