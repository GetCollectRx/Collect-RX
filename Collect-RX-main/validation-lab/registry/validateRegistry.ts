import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const registryDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(registryDir, '../..')

type RegistryEntry = { id: string }

export type ValidationAssertion = {
  id: string
  path: string
  operator: string
  value: unknown
  critical: boolean
}

export type ValidationStep = {
  id: string
  type: string
  actor: string
  input?: unknown
}

export type ValidationScenario = {
  schemaVersion: number
  id: string
  tier: string
  name: string
  description: string
  layer: string
  personas: { collectrx: string[]; carrier: string[] }
  preconditions: {
    syntheticOnly: boolean
    fixtureProfile: string
    services: string[]
    initialState: Record<string, unknown>
  }
  harness: string
  steps: ValidationStep[]
  expected: ValidationAssertion[]
  forbidden: ValidationAssertion[]
  evidence: { requiredArtifacts: string[] }
  sourceRefs: Array<{ path: string; reference: string }>
  tags: string[]
  implementation: string
}

export type ValidationInput = {
  registry: {
    schemaVersion: number
    sourceCatalogSha256: string
    expectedCatalogCount: number
    scenarioCount: number
    scenarios: ValidationScenario[]
  }
  personas: { personas: RegistryEntry[] }
  carrierPersonas: { personas: RegistryEntry[] }
  fixtureProfiles: { profiles: RegistryEntry[] }
}

export type ValidationResult = {
  errors: string[]
  summary: {
    scenarios: number
    collectrxPersonas: number
    carrierPersonas: number
    fixtureProfiles: number
    byTier: Record<string, number>
    byImplementation: Record<string, number>
  }
}

const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9_]+)*$/
const TIERS = new Set(['P0', 'P1', 'P2'])
const LAYERS = new Set(['conversation', 'dispatch', 'handoff', 'ivr', 'post_call', 'ops'])
const HARNESSES = new Set(['carrier_conversation', 'scenario_vitest', 'supervised_pilot', 'telephony_controlled', 'transcript_outcome'])
const IMPLEMENTATIONS = new Set(['implemented', 'partial', 'pilot_only', 'unimplemented'])
const ASSERTION_OPERATORS = new Set(['equals', 'not_equals', 'exists', 'not_exists', 'lte', 'gte', 'contains'])
const ARTIFACTS = new Set(['assertion_results', 'browser_trace', 'event_log', 'manifest', 'manual_signoff', 'sanitized_transcript', 'state_snapshot', 'telephony_metrics'])
const CARRIER_REQUIRED_LAYERS = new Set(['conversation', 'handoff', 'ivr', 'post_call'])

function uniqueIds(items: RegistryEntry[], label: string, errors: string[]): Set<string> {
  const ids = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      errors.push(`${label}[${index}] has no id`)
      continue
    }
    if (ids.has(item.id)) errors.push(`${label} contains duplicate id ${item.id}`)
    ids.add(item.id)
  }
  return ids
}

function validateAssertions(scenarioId: string, name: string, assertions: ValidationAssertion[] | unknown, errors: string[]): void {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    errors.push(`${scenarioId}: ${name} must contain at least one assertion`)
    return
  }
  const ids = new Set<string>()
  for (const [index, assertion] of assertions.entries()) {
    const prefix = `${scenarioId}: ${name}[${index}]`
    if (!assertion || typeof assertion !== 'object') {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (typeof assertion.id !== 'string' || assertion.id.length === 0) errors.push(`${prefix} has no id`)
    else if (ids.has(assertion.id)) errors.push(`${scenarioId}: ${name} contains duplicate assertion id ${assertion.id}`)
    else ids.add(assertion.id)
    if (typeof assertion.path !== 'string' || assertion.path.length === 0) errors.push(`${prefix} has no path`)
    if (!ASSERTION_OPERATORS.has(assertion.operator)) errors.push(`${prefix} has unsupported operator ${String(assertion.operator)}`)
    if (!Object.prototype.hasOwnProperty.call(assertion, 'value')) errors.push(`${prefix} has no value`)
    if (typeof assertion.critical !== 'boolean') errors.push(`${prefix} critical must be boolean`)
  }
}

export function validateRegistryData(input: ValidationInput): ValidationResult {
  const errors: string[] = []
  const scenarios = Array.isArray(input.registry?.scenarios) ? input.registry.scenarios : []
  const personas = Array.isArray(input.personas?.personas) ? input.personas.personas : []
  const carrierPersonas = Array.isArray(input.carrierPersonas?.personas) ? input.carrierPersonas.personas : []
  const fixtureProfiles = Array.isArray(input.fixtureProfiles?.profiles) ? input.fixtureProfiles.profiles : []

  const personaIds = uniqueIds(personas, 'personas', errors)
  const carrierPersonaIds = uniqueIds(carrierPersonas, 'carrierPersonas', errors)
  const fixtureProfileIds = uniqueIds(fixtureProfiles, 'fixtureProfiles', errors)
  const scenarioIds = uniqueIds(scenarios, 'scenarios', errors)

  if (input.registry?.schemaVersion !== 1) errors.push('registry schemaVersion must equal 1')
  if (input.registry?.scenarioCount !== scenarios.length) errors.push(`registry scenarioCount ${String(input.registry?.scenarioCount)} does not match ${scenarios.length}`)
  if (input.registry?.expectedCatalogCount !== scenarios.length) errors.push(`registry expectedCatalogCount ${String(input.registry?.expectedCatalogCount)} does not match ${scenarios.length}`)
  if (scenarioIds.size !== scenarios.length) errors.push('scenario IDs are not unique')

  const usedPersonas = new Set<string>()
  const usedCarrierPersonas = new Set<string>()
  const byTier: Record<string, number> = {}
  const byImplementation: Record<string, number> = {}

  for (const scenario of scenarios) {
    const id = typeof scenario?.id === 'string' && scenario.id ? scenario.id : '<missing-id>'
    if (!ID_PATTERN.test(id)) errors.push(`${id}: invalid stable id`)
    if (scenario?.schemaVersion !== 1) errors.push(`${id}: schemaVersion must equal 1`)
    if (!TIERS.has(scenario?.tier)) errors.push(`${id}: unsupported tier ${String(scenario?.tier)}`)
    if (!LAYERS.has(scenario?.layer)) errors.push(`${id}: unsupported layer ${String(scenario?.layer)}`)
    if (!HARNESSES.has(scenario?.harness)) errors.push(`${id}: unsupported harness ${String(scenario?.harness)}`)
    if (!IMPLEMENTATIONS.has(scenario?.implementation)) errors.push(`${id}: unsupported implementation ${String(scenario?.implementation)}`)
    if (typeof scenario?.name !== 'string' || scenario.name.length === 0) errors.push(`${id}: missing name`)
    if (typeof scenario?.description !== 'string' || scenario.description.length === 0) errors.push(`${id}: missing description`)

    const collectrx = scenario?.personas?.collectrx
    if (!Array.isArray(collectrx) || collectrx.length === 0) errors.push(`${id}: at least one CollectRx persona is required`)
    else {
      if (new Set(collectrx).size !== collectrx.length) errors.push(`${id}: duplicate CollectRx persona assignment`)
      for (const personaId of collectrx) {
        usedPersonas.add(personaId)
        if (!personaIds.has(personaId)) errors.push(`${id}: unsupported CollectRx persona ${String(personaId)}`)
      }
    }

    const carrier = scenario?.personas?.carrier
    if (!Array.isArray(carrier)) errors.push(`${id}: carrier personas must be an array`)
    else {
      if (CARRIER_REQUIRED_LAYERS.has(scenario.layer) && carrier.length === 0) errors.push(`${id}: layer ${scenario.layer} requires a carrier persona`)
      if (new Set(carrier).size !== carrier.length) errors.push(`${id}: duplicate carrier persona assignment`)
      for (const personaId of carrier) {
        usedCarrierPersonas.add(personaId)
        if (!carrierPersonaIds.has(personaId)) errors.push(`${id}: unsupported carrier persona ${String(personaId)}`)
      }
    }

    if (scenario?.preconditions?.syntheticOnly !== true) errors.push(`${id}: preconditions.syntheticOnly must be true`)
    const fixtureProfile = scenario?.preconditions?.fixtureProfile
    if (!fixtureProfileIds.has(fixtureProfile)) errors.push(`${id}: unsupported fixture profile ${String(fixtureProfile)}`)
    if (!Array.isArray(scenario?.preconditions?.services)) errors.push(`${id}: preconditions.services must be an array`)
    if (!scenario?.preconditions?.initialState || typeof scenario.preconditions.initialState !== 'object') errors.push(`${id}: preconditions.initialState is required`)

    if (!Array.isArray(scenario?.steps) || scenario.steps.length === 0) errors.push(`${id}: at least one action is required`)
    else {
      const stepIds = new Set<string>()
      for (const [index, step] of scenario.steps.entries()) {
        if (!step || typeof step !== 'object') errors.push(`${id}: steps[${index}] must be an object`)
        else {
          if (!step.id) errors.push(`${id}: steps[${index}] has no id`)
          else if (stepIds.has(step.id)) errors.push(`${id}: duplicate step id ${step.id}`)
          else stepIds.add(step.id)
          if (!step.type) errors.push(`${id}: steps[${index}] has no type`)
          if (!step.actor) errors.push(`${id}: steps[${index}] has no actor`)
        }
      }
    }

    validateAssertions(id, 'expected', scenario?.expected, errors)
    validateAssertions(id, 'forbidden', scenario?.forbidden, errors)

    const requiredArtifacts = scenario?.evidence?.requiredArtifacts
    if (!Array.isArray(requiredArtifacts) || requiredArtifacts.length === 0) errors.push(`${id}: at least one evidence artifact is required`)
    else {
      for (const artifact of requiredArtifacts) {
        if (!ARTIFACTS.has(artifact)) errors.push(`${id}: unsupported evidence artifact ${String(artifact)}`)
      }
    }
    if (!Array.isArray(scenario?.sourceRefs) || scenario.sourceRefs.length === 0) errors.push(`${id}: at least one source reference is required`)
    if (!Array.isArray(scenario?.tags) || scenario.tags.length === 0) errors.push(`${id}: at least one tag is required`)

    byTier[scenario.tier] = (byTier[scenario.tier] ?? 0) + 1
    byImplementation[scenario.implementation] = (byImplementation[scenario.implementation] ?? 0) + 1
  }

  for (const personaId of personaIds) {
    if (!usedPersonas.has(personaId)) errors.push(`CollectRx persona ${personaId} is not assigned to any scenario`)
  }
  for (const personaId of carrierPersonaIds) {
    if (!usedCarrierPersonas.has(personaId)) errors.push(`carrier persona ${personaId} is not assigned to any scenario`)
  }

  return {
    errors,
    summary: {
      scenarios: scenarios.length,
      collectrxPersonas: personaIds.size,
      carrierPersonas: carrierPersonaIds.size,
      fixtureProfiles: fixtureProfileIds.size,
      byTier,
      byImplementation,
    },
  }
}

function parseCsvIds(text: string): string[] {
  const lines = text.trim().split(/\r?\n/)
  return lines.slice(1).map((line) => line.match(/^(?:"((?:[^"]|"")*)"|([^,]*))/)?.slice(1).find((value) => value !== undefined)?.replace(/""/g, '"') ?? '')
}

export function loadAndValidateRegistry(): ValidationResult {
  const readJson = (fileName: string): unknown => JSON.parse(readFileSync(join(registryDir, fileName), 'utf8'))
  const registry = readJson('scenarios.json') as ValidationInput['registry']
  const input: ValidationInput = {
    registry,
    personas: readJson('personas.json') as ValidationInput['personas'],
    carrierPersonas: readJson('carrier-personas.json') as ValidationInput['carrierPersonas'],
    fixtureProfiles: readJson('fixture-profiles.json') as ValidationInput['fixtureProfiles'],
  }
  const result = validateRegistryData(input)

  const sourcePath = join(appRoot, 'voice-agent-sim/SCENARIO-MASTER.csv')
  const sourceText = readFileSync(sourcePath, 'utf8')
  const sourceHash = createHash('sha256').update(sourceText).digest('hex')
  if (registry.sourceCatalogSha256 !== sourceHash) result.errors.push('scenario registry is stale: source catalog SHA-256 changed')

  const sourceIds = parseCsvIds(sourceText)
  const registryIds = registry.scenarios.map((scenario) => scenario.id)
  const sourceSet = new Set(sourceIds)
  const registrySet = new Set(registryIds)
  for (const id of sourceSet) if (!registrySet.has(id)) result.errors.push(`source scenario ${id} is missing from registry`)
  for (const id of registrySet) if (!sourceSet.has(id)) result.errors.push(`registry scenario ${id} is missing from source catalog`)

  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = loadAndValidateRegistry()
  if (result.errors.length > 0) {
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
  } else {
    process.stdout.write(`${JSON.stringify({ valid: true, ...result.summary }, null, 2)}\n`)
  }
}
