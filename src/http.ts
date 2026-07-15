import type { ApiErrorData, Env } from './types'

export class ResponseError extends Error {
  status: number
  data?: ApiErrorData

  constructor(message: string, status = 500, data?: ApiErrorData) {
    super(message)
    this.status = status
    this.data = data
  }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    }
  })
}

export const ok = <T>(data: T, headers: HeadersInit = {}) => json({ success: true, data }, 200, headers)

export const fail = (message: string, status = 500, headers: HeadersInit = {}, data?: ApiErrorData) =>
  json({ success: false, message, ...(data ? { data } : {}) }, status, headers)

export const corsHeaders = (request: Request, env: Env) => {
  const origin = request.headers.get('origin') || ''
  const allowOrigin = origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400'
  }
}

export const readJson = async <T = Record<string, unknown>>(request: Request): Promise<T> => {
  try {
    return await request.json<T>()
  } catch {
    throw new ResponseError('请求体格式不正确', 400)
  }
}

export const getClientIp = (request: Request) =>
  request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''

export const nowIso = () => new Date().toISOString()

export const randomId = () => crypto.randomUUID()
