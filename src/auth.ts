import type { DnsUser, Env, MailUserInfo } from './types'
import { ResponseError } from './http'
import { ensureCoordinatedUser } from './user-coordinator-client'

interface MailEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

interface RawMailUser {
  userId?: number | string
  uid?: number | string
  id?: number | string
  email?: string
  name?: string
  account?: {
    accountId?: number | string
    email?: string
  }
  permKeys?: string[]
}

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '')

const normalizeToken = (value: string | null) => {
  if (!value) throw new ResponseError('未登录', 401)
  const token = value.trim()
  return token.startsWith('Bearer ') ? token.slice(7).trim() : token
}

const normalizeEmail = (value?: string) => {
  const email = value?.trim().toLowerCase()
  if (!email) throw new ResponseError('无法获取当前邮箱', 403)
  return email
}

export const getMailToken = (request: Request) => normalizeToken(request.headers.get('authorization'))

export const getCurrentMailUser = async (request: Request, env: Env): Promise<MailUserInfo> => {
  const token = getMailToken(request)
  const res = await fetch(`${normalizeBaseUrl(env.MAIL_API_BASE_URL)}/my/loginUserInfo`, {
    headers: { Authorization: token }
  })

  if (!res.ok) {
    throw new ResponseError('登录状态已失效', 401)
  }

  const payload = await res.json<MailEnvelope<RawMailUser> | RawMailUser>()
  const data = ('data' in payload && payload.data ? payload.data : payload) as RawMailUser
  if (!data) throw new ResponseError('无法获取当前用户', 403)

  const email = normalizeEmail(data.email || data.account?.email)
  const uid = String(data.userId || data.uid || data.id || data.account?.accountId || email)

  return {
    uid,
    email,
    name: data.name,
    raw: data
  }
}

export const ensureDnsUser = (env: Env, mailUser: MailUserInfo, enforceBan = true): Promise<DnsUser> =>
  ensureCoordinatedUser(env, mailUser, enforceBan)

export const requireUser = async (request: Request, env: Env) => {
  const mailUser = await getCurrentMailUser(request, env)
  const dnsUser = await ensureDnsUser(env, mailUser)
  return { mailUser, dnsUser }
}

export const requireAdmin = async (request: Request, env: Env) => {
  const mailUser = await getCurrentMailUser(request, env)
  const admins = env.DNS_ADMIN_EMAILS
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  if (!admins.includes(mailUser.email.toLowerCase())) {
    throw new ResponseError('无管理员权限', 403)
  }
  // DNS service bans deliberately do not revoke administration access.
  // Keep all durable mirrors synchronized while bypassing only the feature gate.
  const dnsUser = await ensureDnsUser(env, mailUser, false)
  return { mailUser, dnsUser }
}
