import { describe, expect, it } from 'vitest'

const reserve = (
  state: { users: Set<string>; useCount: number; maxUses: number; active: boolean; expiresAt?: string },
  uid: string,
) => {
  if (state.users.has(uid)) return 'already_redeemed'
  if (!state.active) return 'inactive'
  if (state.expiresAt && Date.parse(state.expiresAt) <= Date.now()) return 'expired'
  if (state.useCount >= state.maxUses) return 'exhausted'
  state.users.add(uid)
  state.useCount += 1
  return 'ok'
}

describe('redemption policy', () => {
  it('allows each user once and enforces the global limit', () => {
    const state = { users: new Set<string>(), useCount: 0, maxUses: 2, active: true }
    expect(reserve(state, 'u1')).toBe('ok')
    expect(reserve(state, 'u1')).toBe('already_redeemed')
    expect(reserve(state, 'u2')).toBe('ok')
    expect(reserve(state, 'u3')).toBe('exhausted')
    expect(state.useCount).toBe(2)
  })

  it('rejects inactive and expired codes before consuming capacity', () => {
    const inactive = { users: new Set<string>(), useCount: 0, maxUses: 1, active: false }
    expect(reserve(inactive, 'u1')).toBe('inactive')
    expect(inactive.useCount).toBe(0)

    const expired = {
      users: new Set<string>(), useCount: 0, maxUses: 1, active: true,
      expiresAt: '2020-01-01T00:00:00.000Z',
    }
    expect(reserve(expired, 'u1')).toBe('expired')
    expect(expired.useCount).toBe(0)
  })
})
