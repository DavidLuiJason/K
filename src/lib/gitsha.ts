/**
 * Computes git blob SHA-1.
 */

export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const headerStr = `blob ${bytes.length}\0`;
  const headerBytes = new TextEncoder().encode(headerStr);
  const combined = new Uint8Array(headerBytes.length + bytes.length);
  combined.set(headerBytes, 0);
  combined.set(bytes, headerBytes.length);

  const digestBuffer = await crypto.subtle.digest('SHA-1', combined);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}
