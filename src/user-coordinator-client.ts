import type { BanEvent, DnsRecord, DnsUser, Env, MailUserInfo, Settings } from './types'
import { ResponseError, getClientIp } from './http'

export type UserCoordinatorAction =
  | 'ensure-user'
  | 'create-user'
  | 'adjust-points'
  | 'set-ban'
  | 'delete-user'
  | 'create-record'
  | 'update-record'
  | 'toggle-record'
  | 'delete-record'

interface CoordinatorResponse<T> {
  success: boolean
  data?: T | import('./types').ApiErrorData
  message?: string
  status?: number
}

type CoordinatorFetcher = Pick<DurableObjectStub, 'fetch'>

export const requestUserCoordinator = async <T>(
  env: Env,
  uid: string,
  action: UserCoordinatorAction,
  payload: unknown,
  coordinator?: CoordinatorFetcher
): Promise<T> => {
  const stub = coordinator || env.USER_COORDINATOR.getByName(uid)
  const response = await stub.fetch('https://user-coordinator.internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, uid, payload })
  })
  const result = await response.json<CoordinatorResponse<T>>()
  if (!response.ok || !result.success) {
    throw new ResponseError(
      result.message || '用户操作失败',
      result.status || response.status || 500,
      result.data as import('./types').ApiErrorData | undefined
    )
  }
  return result.data as T
}

export const ensureCoordinatedUser = (env: Env, mailUser: MailUserInfo, enforceBan = true) =>
  requestUserCoordinator<DnsUser>(env, mailUser.uid, 'ensure-user', {
    mailUser: { uid: mailUser.uid, email: mailUser.email, name: mailUser.name },
    enforceBan
  })

export const createCoordinatedUser = (env: Env, user: DnsUser) =>
  requestUserCoordinator<DnsUser>(env, user.uid, 'create-user', { user })

export const adjustCoordinatedPoints = (env: Env, uid: string, delta: number, message?: string, operationId?: string) =>
  requestUserCoordinator(env, uid, 'adjust-points', { delta, message, operationId })

export const setCoordinatedBan = (
  env: Env,
  uid: string,
  input: {
    banned: boolean
    reason?: string
    presetId?: string
    actorUid: string
    actorEmail: string
    operationId: string
  }
) => requestUserCoordinator<{ user: DnsUser; event: BanEvent }>(env, uid, 'set-ban', input)

export const deleteCoordinatedUser = (env: Env, uid: string) =>
  requestUserCoordinator<{ uid: string }>(env, uid, 'delete-user', null)

export const createUserCoordinatedRecord = (
  env: Env,
  uid: string,
  root: string,
  request: Request,
  settings: Settings,
  body: Record<string, unknown>
) =>
  requestUserCoordinator<{ record: DnsRecord; user: DnsUser }>(env, uid, 'create-record', {
    root,
    settings,
    body,
    clientIp: getClientIp(request)
  })

export const updateUserCoordinatedRecord = (
  env: Env,
  uid: string,
  root: string,
  settings: Settings,
  id: string,
  body: Record<string, unknown>
) => requestUserCoordinator<DnsRecord>(env, uid, 'update-record', { root, settings, id, body })

export const toggleUserCoordinatedRecord = (env: Env, uid: string, root: string, settings: Settings, id: string) =>
  requestUserCoordinator<DnsRecord>(env, uid, 'toggle-record', { root, settings, id })

export const deleteUserCoordinatedRecord = (env: Env, uid: string, root: string, settings: Settings, id: string) =>
  requestUserCoordinator<{ record: DnsRecord; user: DnsUser }>(env, uid, 'delete-record', { root, settings, id })
