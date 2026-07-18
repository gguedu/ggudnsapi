import type { DnsUser, Env } from './types'
import type { CurrentBanState } from './user-access'
import { ResponseError } from './http'
import { getUser } from './kv'

export interface DnsUserSnapshot {
  user: DnsUser | null
  access: CurrentBanState | null
}

export const readDnsUserSnapshot = async (env: Env, uid: string): Promise<DnsUserSnapshot> => {
  const storedUser = await getUser(env, uid)
  if (!storedUser) return { user: null, access: null }

  const [balance, access] = await Promise.all([
    env.USER_POINTS.getByName(uid).getBalance(),
    env.USER_ACCESS.getByName(uid).getState()
  ])

  return {
    user: {
      ...storedUser,
      points: balance ?? storedUser.points,
      banned: access?.banned ?? storedUser.banned,
      bannedReason: access ? access.reason : storedUser.bannedReason,
      bannedAt: access ? access.bannedAt : storedUser.bannedAt,
      bannedByUid: access ? access.bannedByUid : storedUser.bannedByUid,
      bannedByEmail: access ? access.bannedByEmail : storedUser.bannedByEmail
    },
    access
  }
}

export const assertDnsServiceAllowed = ({ user, access }: DnsUserSnapshot) => {
  const banned = access?.banned ?? user?.banned ?? false
  if (!banned) return

  throw new ResponseError('该账号已被限制使用 DNS 服务', 403, {
    code: 'DNS_USER_BANNED',
    reason: access?.reason || user?.bannedReason || '未提供封禁原因',
    bannedAt: access?.bannedAt || user?.bannedAt
  })
}

export const requireDnsUserSnapshot = async (env: Env, uid: string, enforceBan = true) => {
  const snapshot = await readDnsUserSnapshot(env, uid)
  if (enforceBan) assertDnsServiceAllowed(snapshot)
  if (!snapshot.user) {
    throw new ResponseError('DNS 用户尚未初始化', 404, { code: 'DNS_USER_NOT_INITIALIZED' })
  }
  return snapshot.user
}
