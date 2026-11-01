import test from 'node:test'
import assert from 'node:assert/strict'
import { getApiBase, normalizeApiBase, resetApiBase, saveApiBase } from './apiConfig.ts'

test('service address accepts HTTPS roots and reverse-proxy prefixes', () => {
  assert.equal(normalizeApiBase(' https://EXAMPLE.com:443/ '), 'https://example.com')
  assert.equal(normalizeApiBase('https://example.com/hongguo///'), 'https://example.com/hongguo')
})

test('service address rejects insecure URLs, embedded credentials and page parameters', () => {
  for (const address of ['http://example.com', 'file:///data/server', 'example.com', 'https://name:password@example.com', 'https://example.com/?token=value', 'https://example.com/#login', 'https://example.com/api/']) {
    assert.throws(() => normalizeApiBase(address))
  }
})

test('runtime address is normalized, reusable and reset without persisting account data', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
  try {
    saveApiBase('https://example.com/hongguo/')
    assert.equal(getApiBase(), 'https://example.com/hongguo')
    assert.deepEqual([...values.keys()], ['hongguo.apiBaseUrl'])
    resetApiBase()
    assert.equal(values.size, 0)
    assert.equal(getApiBase(), '')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
