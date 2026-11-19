import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAndValidateRegistry, validateRegistryData, type ValidationInput } from '../../validation-lab/registry/validateRegistry'

const appRoot = resolve(__dirname, '../..')
const registryDir = join(appRoot, 'validation-lab/registry')

function loadInput(): ValidationInput {
  const readJson = (name: string) => JSON.parse(readFileSync(join(registryDir, name), 'utf8'))
  return {
    registry: readJson('scenarios.json'),
    personas: readJson('personas.json'),
    carrierPersonas: readJson('carrier-personas.json'),
    fixtureProfiles: readJson('fixture-profiles.json'),
  }
}

function cloneInput(): ValidationInput {
  return structuredClone(loadInput())
}

describe('validation-lab scenario registry', () => {
  it('validates the on-disk registry and source-catalog parity', () => {
    const result = loadAndValidateRegistry()
    expect(result.errors).toEqual([])
    expect(result.summary).toMatchObject({
      scenarios: 248,
      collectrxPersonas: 11,
      carrierPersonas: 16,
      fixtureProfiles: 10,
      byTier: { P0: 179, P1: 60, P2: 9 },
      byImplementation: { unimplemented: 181, partial: 57, pilot_only: 10 },
    })
  })

  it('rejects duplicate scenario IDs', () => {
    const input = cloneInput()
    input.registry.scenarios[1].id = input.registry.scenarios[0].id
    expect(validateRegistryData(input).errors.some((error) => error.includes('duplicate id'))).toBe(true)
  })

  it('rejects missing expected assertions', () => {
    const input = cloneInput()
    input.registry.scenarios[0].expected = []
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: expected must contain at least one assertion`)
  })

  it('rejects missing forbidden assertions', () => {
    const input = cloneInput()
    input.registry.scenarios[0].forbidden = []
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: forbidden must contain at least one assertion`)
  })

  it('rejects an unsupported CollectRx persona', () => {
    const input = cloneInput()
    input.registry.scenarios[0].personas.collectrx = ['invented_role']
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: unsupported CollectRx persona invented_role`)
  })

  it('rejects an unsupported carrier persona', () => {
    const input = cloneInput()
    input.registry.scenarios[0].personas.carrier = ['invented_carrier_role']
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: unsupported carrier persona invented_carrier_role`)
  })

  it('rejects a missing fixture-profile reference', () => {
    const input = cloneInput()
    input.registry.scenarios[0].preconditions.fixtureProfile = 'missing_fixture'
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: unsupported fixture profile missing_fixture`)
  })

  it('rejects a scenario with no actions', () => {
    const input = cloneInput()
    input.registry.scenarios[0].steps = []
    expect(validateRegistryData(input).errors).toContain(`${input.registry.scenarios[0].id}: at least one action is required`)
  })
})
