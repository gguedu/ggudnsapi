import type { DnsRecord, DnsUser, Env, ManagedDomain, Settings } from './types'
import { ResponseError, getClientIp } from './http'

export type DomainCoordinatorAction =
  | 'get-domain'
  | 'put-domain'
  | 'delete-domain'
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

const requestCoordinator = async <T>(
  env: Env,
  root: string,
  action: DomainCoordinatorAction,
  payload: unknown,
  coordinator?: CoordinatorFetcher
): Promise<T> => {
  const stub = coordinator || env.DOMAIN_COORDINATOR.getByName(root)
  const response = await stub.fetch('https://domain-coordinator.internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, root, payload })
  })
  const result = await response.json<CoordinatorResponse<T>>()
  if (!response.ok || !result.success) {
    throw new ResponseError(
      result.message || '域名操作失败',
      result.status || response.status || 500,
      result.data as import('./types').ApiErrorData | undefined
    )
  }
  return result.data as T
}

export const getCoordinatedDomain = (env: Env, root: string, coordinator?: CoordinatorFetcher) =>
  requestCoordinator<ManagedDomain | null>(env, root, 'get-domain', null, coordinator)

export const putCoordinatedDomain = (env: Env, domain: ManagedDomain, mode: 'create' | 'update') =>
  requestCoordinator<ManagedDomain>(env, domain.root, 'put-domain', { domain, mode })

export const deleteCoordinatedDomain = (env: Env, root: string) =>
  requestCoordinator<ManagedDomain | { root: string }>(env, root, 'delete-domain', null)

export const createCoordinatedRecord = (
  env: Env,
  root: string,
  request: Request,
  user: DnsUser,
  settings: Settings,
  body: Record<string, unknown>
) =>
  requestCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'create-record', {
    user,
    settings,
    body,
    clientIp: getClientIp(request)
  })

export const updateCoordinatedRecord = (
  env: Env,
  root: string,
  user: DnsUser,
  settings: Settings,
  id: string,
  body: Record<string, unknown>
) => requestCoordinator<DnsRecord>(env, root, 'update-record', { user, settings, id, body })

export const toggleCoordinatedRecord = (env: Env, root: string, user: DnsUser, settings: Settings, id: string) =>
  requestCoordinator<DnsRecord>(env, root, 'toggle-record', { user, settings, id })

export const deleteCoordinatedRecord = (env: Env, root: string, user: DnsUser, settings: Settings, id: string) =>
  requestCoordinator<{ record: DnsRecord; user: DnsUser }>(env, root, 'delete-record', { user, settings, id })

export const requestDomainCoordinator = requestCoordinator
