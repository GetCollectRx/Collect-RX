import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  signBriefSessionToken,
  signPlatformDevToken,
  signUserToken,
  verifyAuthToken,
} from '../../src/server/authToken.js'
import {
  getUserRole,
  hasPhiAccess,
  isPlatformDev,
  isPlatformUserSession,
  practiceRoleToBrief,
  type PracticeRole,
} from '../../src/server/accessControl/types.js'

interface Persona {
  id: string
  authSource: 'practice_user' | 'platform_user' | 'internal_platform'
  effectiveUserRole: string
  jwtRole: string
  platformUserSession: boolean
  phiAccess: boolean
  allowedActions: string[]
  forbiddenActions: string[]
}

interface PersonaRegistry {
  schemaVersion: number
  personas: Persona[]
}

process.env.JWT_SECRET = 'validation-lab-stage7-secret'

const registry = JSON.parse(
  readFileSync(new URL('../../validation-lab/registry/personas.json', import.meta.url), 'utf8'),
) as PersonaRegistry

const byId = new Map(registry.personas.map((persona) => [persona.id, persona]))

const practiceRoles: PracticeRole[] = [
  'practice_owner',
  'office_manager',
  'billing_coordinator',
  'front_desk',
  'associate_dentist',
  'accountant',
  'group_admin',
]

const platformRoles = ['auditor', 'billing_ops_manager', 'platform_admin'] as const

describe('validation lab persona identity contract', () => {
  it('registers eleven unique personas with explicit allowed and forbidden actions', () => {
    expect(registry.schemaVersion).toBe(1)
    expect(registry.personas).toHaveLength(11)
    expect(byId.size).toBe(11)

    for (const persona of registry.personas) {
      expect(persona.allowedActions.length).toBeGreaterThan(0)
      expect(persona.forbiddenActions.length).toBeGreaterThan(0)
    }
  })

  it.each(practiceRoles)('%s produces the declared practice JWT identity and PHI boundary', (role) => {
    const persona = byId.get(role)
    expect(persona).toBeDefined()
    expect(persona).toMatchObject({
      authSource: 'practice_user',
      effectiveUserRole: role,
      jwtRole: role,
      platformUserSession: false,
    })

    const token = signUserToken({
      userId: `synthetic-${role}`,
      practiceId: 'synthetic-practice-a',
      role,
      ...(role === 'associate_dentist' ? { providerId: 'synthetic-provider-a' } : {}),
    })
    const auth = verifyAuthToken(token)

    expect(auth.role).toBe(persona!.jwtRole)
    expect(auth.practiceId).toBe('synthetic-practice-a')
    expect(hasPhiAccess(auth)).toBe(persona!.phiAccess)
    expect(isPlatformUserSession(auth)).toBe(false)
    expect(isPlatformDev(auth)).toBe(false)
    expect(getUserRole(auth)).toBe(practiceRoleToBrief(role))

    if (role === 'associate_dentist') {
      expect('providerId' in auth ? auth.providerId : undefined).toBe('synthetic-provider-a')
    }
  })

  it.each(platformRoles)('%s stays a platform-user session rather than becoming technical steward', (role) => {
    const persona = byId.get(role)
    expect(persona).toBeDefined()
    expect(persona).toMatchObject({
      authSource: 'platform_user',
      effectiveUserRole: role,
      platformUserSession: true,
    })

    const token = signBriefSessionToken({
      userRole: role,
      userId: `synthetic-${role}`,
      practiceId: role === 'auditor' ? 'synthetic-practice-a' : null,
      phiAccess: persona!.phiAccess,
    })
    const auth = verifyAuthToken(token)

    expect(auth.role).toBe(persona!.jwtRole)
    expect(getUserRole(auth)).toBe(role)
    expect(hasPhiAccess(auth)).toBe(persona!.phiAccess)
    expect(isPlatformUserSession(auth)).toBe(true)
    expect(isPlatformDev(auth)).toBe(false)
  })

  it('keeps technical steward PHI-free and distinct from a platform-admin session', () => {
    const persona = byId.get('platform_dev')
    expect(persona).toMatchObject({
      authSource: 'internal_platform',
      effectiveUserRole: 'platform_dev',
      jwtRole: 'platform_dev',
      platformUserSession: false,
      phiAccess: false,
    })

    const auth = verifyAuthToken(signPlatformDevToken())

    expect(auth.role).toBe('platform_dev')
    expect(auth.practiceId).toBeNull()
    expect(hasPhiAccess(auth)).toBe(false)
    expect(isPlatformUserSession(auth)).toBe(false)
    expect(isPlatformDev(auth)).toBe(true)
  })
})
