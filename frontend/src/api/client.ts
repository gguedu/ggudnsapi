import type { ApiEnvelope } from '../types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function token(): string {
  return localStorage.getItem('mail_token') || ''
}

export function setToken(t: string) {
  localStorage.setItem('mail_token', t)
}

export function clearToken() {
  localStorage.removeItem('mail_token')
}

export function hasToken(): boolean {
  return !!localStorage.getItem('mail_token')
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  skipAuth = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (!skipAuth) {
    headers['Authorization'] = token()
  }
  const res = await fetch(path, { ...options, headers })
  const body: ApiEnvelope<T> = await res.json().catch(() => ({} as ApiEnvelope<T>))
  if (!res.ok || body.success === false) {
    throw new ApiError(body.message || `HTTP ${res.status}`, res.status)
  }
  return body.data as T
}
