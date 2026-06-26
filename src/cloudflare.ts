import type { CfAccount, CfDnsRecord, CfZone, DnsRecordInput, Env } from './types'
import { ResponseError } from './http'

interface CfAccountInfo {
  id: string
  name: string
}

interface CfEnvelope<T> {
  success: boolean
  result: T
  errors?: Array<{ message?: string }>
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const toBase64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))

const keyFromSecret = async (secret: string) => {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export const encryptSecret = async (env: Env, value: string) => {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) return value
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFromSecret(env.CREDENTIALS_ENCRYPTION_KEY)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(value))
  return `${toBase64(iv.buffer)}.${toBase64(encrypted)}`
}

export const decryptSecret = async (env: Env, value?: string) => {
  if (!value) return ''
  if (!env.CREDENTIALS_ENCRYPTION_KEY || !value.includes('.')) return value
  const [ivText, dataText] = value.split('.')
  const key = await keyFromSecret(env.CREDENTIALS_ENCRYPTION_KEY)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText) }, key, fromBase64(dataText))
  return textDecoder.decode(decrypted)
}

const authHeaders = async (env: Env, account: CfAccount) => {
  if (account.authType === 'token') {
    return {
      Authorization: `Bearer ${await decryptSecret(env, account.apiTokenEncrypted)}`
    }
  }
  return {
    'X-Auth-Email': account.email || '',
    'X-Auth-Key': await decryptSecret(env, account.apiKeyEncrypted)
  }
}

export const cfRequest = async <T>(env: Env, account: CfAccount, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  for (const [key, value] of Object.entries(await authHeaders(env, account))) headers.set(key, value)

  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers
  })
  const payload = await res.json<CfEnvelope<T>>()
  if (!res.ok || !payload.success) {
    throw new ResponseError(payload.errors?.[0]?.message || 'Cloudflare API 请求失败', res.status || 502)
  }
  return payload.result
}

export const listCloudflareAccounts = (env: Env, account: CfAccount) =>
  cfRequest<CfAccountInfo[]>(env, account, '/accounts?per_page=100')

export const listZones = (env: Env, account: CfAccount) =>
  cfRequest<CfZone[]>(env, account, '/zones?per_page=100')

export const listDnsRecords = (env: Env, account: CfAccount, zoneId: string, name?: string, type?: string) => {
  const params = new URLSearchParams({ per_page: '100' })
  if (name) params.set('name', name)
  if (type) params.set('type', type)
  return cfRequest<CfDnsRecord[]>(env, account, `/zones/${zoneId}/dns_records?${params}`)
}

export const getDnsRecord = (env: Env, account: CfAccount, zoneId: string, recordId: string) =>
  cfRequest<CfDnsRecord>(env, account, `/zones/${zoneId}/dns_records/${recordId}`)

export const createDnsRecord = (env: Env, account: CfAccount, zoneId: string, payload: DnsRecordInput) => {
  const body: Record<string, unknown> = {
    name: payload.fullDomain,
    type: payload.type,
    content: payload.content,
    ttl: payload.ttl,
    proxied: payload.proxied || false,
    comment: payload.comment
  }
  if (payload.type === 'MX' && payload.priority !== undefined) body.priority = payload.priority
  return cfRequest<CfDnsRecord>(env, account, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export const patchDnsRecord = (env: Env, account: CfAccount, zoneId: string, recordId: string, payload: DnsRecordInput) => {
  const body: Record<string, unknown> = {
    name: payload.fullDomain,
    type: payload.type,
    content: payload.content,
    ttl: payload.ttl,
    proxied: payload.proxied || false,
    comment: payload.comment
  }
  if (payload.type === 'MX' && payload.priority !== undefined) body.priority = payload.priority
  return cfRequest<CfDnsRecord>(env, account, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export const deleteDnsRecord = (env: Env, account: CfAccount, zoneId: string, recordId: string) =>
  cfRequest<{ id: string }>(env, account, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' })

export const safeDeleteDnsRecord = async (env: Env, account: CfAccount, zoneId: string, recordId: string) => {
  try {
    await deleteDnsRecord(env, account, zoneId, recordId)
    return true
  } catch (error) {
    if (error instanceof ResponseError && error.status === 404) return false
    throw error
  }
}
