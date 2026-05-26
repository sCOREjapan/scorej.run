/**
 * lib/cryptoPolyfill.ts
 *
 * WebCrypto API polyfill for React Native using expo-crypto.
 * Must be imported BEFORE @supabase/supabase-js is initialized.
 *
 * Without this, Supabase falls back to "plain" PKCE code challenge method,
 * which Supabase server rejects → "invalid flow state" OAuth error.
 */

import { digestStringAsync, getRandomBytes, CryptoDigestAlgorithm, CryptoEncoding } from 'expo-crypto'

function needsPolyfill(): boolean {
  try {
    return (
      typeof (globalThis as any).crypto === 'undefined' ||
      typeof (globalThis as any).crypto?.subtle === 'undefined' ||
      typeof (globalThis as any).crypto?.subtle?.digest !== 'function'
    )
  } catch {
    return true
  }
}

if (needsPolyfill()) {
  const subtlePolyfill = {
    digest: async (algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> => {
      // Normalize input to Uint8Array
      let bytes: Uint8Array
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data)
      } else {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      }

      // Convert bytes back to string.
      // PKCE verifiers are ASCII-only (URL-safe base64 alphabet), so this is safe.
      // digestStringAsync hashes the UTF-8 bytes of the string, which == SHA256(bytes) for ASCII.
      let str = ''
      for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i])
      }

      const algo =
        (algorithm === 'SHA-256' || algorithm === 'SHA256')
          ? CryptoDigestAlgorithm.SHA256
          : (algorithm === 'SHA-1' || algorithm === 'SHA1')
          ? CryptoDigestAlgorithm.SHA1
          : CryptoDigestAlgorithm.SHA256

      const hex: string = await digestStringAsync(algo, str, { encoding: CryptoEncoding.HEX })

      // Convert hex string → ArrayBuffer
      const result = new Uint8Array(hex.length / 2)
      for (let i = 0; i < hex.length; i += 2) {
        result[i / 2] = parseInt(hex.slice(i, i + 2), 16)
      }
      return result.buffer
    },
  }

  const getRandomValuesPolyfill = <T extends ArrayBufferView | null>(array: T): T => {
    if (array === null) return array
    const bytes = getRandomBytes((array as ArrayBufferView).byteLength)
    new Uint8Array(
      (array as ArrayBufferView).buffer,
      (array as ArrayBufferView).byteOffset,
      (array as ArrayBufferView).byteLength
    ).set(bytes)
    return array
  }

  ;(globalThis as any).crypto = {
    getRandomValues: getRandomValuesPolyfill,
    subtle: subtlePolyfill,
  }
}
