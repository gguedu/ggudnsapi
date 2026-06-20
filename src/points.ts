import type { DnsUser, Env, PointLog } from './types'
import { ResponseError, nowIso, randomId } from './http'
import { getUser, putPointLog, putUser } from './kv'

type PointReason = PointLog['reason']

export const createPointLog = (
  user: DnsUser,
  delta: number,
  reason: PointReason,
  options: { recordId?: string; message?: string } = {}
): PointLog => ({
  id: randomId(),
  uid: user.uid,
  delta,
  balanceAfter: user.points,
  reason,
  recordId: options.recordId,
  message: options.message,
  createdAt: nowIso()
})

export const persistPointChange = async (
  env: Env,
  user: DnsUser,
  delta: number,
  reason: PointReason,
  options: { recordId?: string; message?: string } = {}
) => {
  const latest = (await getUser(env, user.uid)) || user
  const next: DnsUser = {
    ...latest,
    points: latest.points + delta,
    lastSeenAt: nowIso()
  }

  if (next.points < 0) throw new ResponseError('积分不足', 400)

  await putUser(env, next)
  const log = createPointLog(next, delta, reason, options)
  await putPointLog(env, log)
  return { user: next, log }
}

export const spendPoints = (env: Env, user: DnsUser, amount: number, recordId: string) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new ResponseError('积分配置不正确', 500)
  return persistPointChange(env, user, -amount, 'create_record', { recordId, message: `创建解析扣减 ${amount} 积分` })
}

export const refundPoints = (env: Env, user: DnsUser, amount: number, recordId: string) => {
  if (!Number.isFinite(amount) || amount <= 0) throw new ResponseError('积分配置不正确', 500)
  return persistPointChange(env, user, amount, 'delete_refund', { recordId, message: `删除解析退还 ${amount} 积分` })
}

export const adjustPoints = (env: Env, user: DnsUser, delta: number, message?: string) => {
  if (!Number.isFinite(delta) || delta === 0) throw new ResponseError('积分变更数量不正确', 400)
  return persistPointChange(env, user, delta, 'admin_adjust', { message })
}
