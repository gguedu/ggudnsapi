import type { DnsUser, Env, MailUserInfo } from './types'
import { ResponseError, nowIso, randomId } from './http'
import { getSettings, getUser, putPointLog, putUser } from './kv'

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

export const ensureDnsUser = async (env: Env, mailUser: MailUserInfo, enforceBan = true): Promise<DnsUser> => {
  const existing = await getUser(env, mailUser.uid)
  const access = await env.USER_ACCESS.getByName(mailUser.uid).getState()
  const now = nowIso()
  if (existing) {
    const authoritativeBalance = await env.USER_POINTS.getByName(mailUser.uid).getBalance(existing.points)
    const next: DnsUser = {
      ...existing,
      email: mailUser.email,
      name: mailUser.name || existing.name,
      points: authoritativeBalance ?? existing.points,
      banned: access?.banned ?? existing.banned,
      bannedReason: access ? access.reason : existing.bannedReason,
      bannedAt: access ? access.bannedAt : existing.bannedAt,
      bannedByUid: access ? access.bannedByUid : existing.bannedByUid,
      bannedByEmail: access ? access.bannedByEmail : existing.bannedByEmail,
      lastSeenAt: now
    }
    await putUser(env, next)
    if (enforceBan && next.banned) {
      throw new ResponseError('该账号已被限制使用 DNS 服务', 403, {
        code: 'DNS_USER_BANNED',
        reason: next.bannedReason || '未提供封禁原因',
        bannedAt: next.bannedAt
      })
    }
    return next
  }

  const settings = await getSettings(env)
  if (enforceBan && access?.banned) {
    throw new ResponseError('该账号已被限制使用 DNS 服务', 403, {
      code: 'DNS_USER_BANNED',
      reason: access.reason || '未提供封禁原因',
      bannedAt: access.bannedAt
    })
  }
  const initialPoints = Number.isSafeInteger(settings.initialPoints)
    ? settings.initialPoints
    : Number(env.DEFAULT_INITIAL_POINTS || 1)
  if (!Number.isSafeInteger(initialPoints) || initialPoints < 0) {
    throw new ResponseError('初始积分配置不正确', 500)
  }
  const user: DnsUser = {
    uid: mailUser.uid,
    email: mailUser.email,
    name: mailUser.name,
    points: initialPoints,
    initialGrantDone: true,
    banned: access?.banned,
    bannedReason: access?.reason,
    bannedAt: access?.bannedAt,
    bannedByUid: access?.bannedByUid,
    bannedByEmail: access?.bannedByEmail,
    createdAt: now,
    lastSeenAt: now
  }
  const initialization = await env.USER_POINTS.getByName(user.uid).initializeUser(user.uid, user.points)
  if (!initialization.ok) throw new ResponseError(initialization.message, 500)
  await putUser(env, user)
  if (initialPoints > 0) {
    await putPointLog(env, {
      id: randomId(),
      uid: user.uid,
      delta: initialPoints,
      balanceAfter: user.points,
      reason: 'initial_grant',
      message: '首次登录赠送积分',
      createdAt: now
    })
  }
  return user
}

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
