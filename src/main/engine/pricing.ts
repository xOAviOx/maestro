import fs from 'fs'
import path from 'path'
import { PricingTableSchema, type PricingTable } from '@shared/types'
import { maestroHome } from './util/paths'
import { log } from '../log'

/**
 * Main-process pricing I/O. The pure cost math lives in `@shared/cost` (no Node
 * built-ins) so the renderer can price events too; it is re-exported here so
 * existing `./pricing` imports keep working unchanged.
 */
export {
  DEFAULT_PRICING,
  priceForModel,
  computeCostUsd,
  eventCostUsd,
  summarizeUsage
} from '@shared/cost'
import { DEFAULT_PRICING } from '@shared/cost'

/** Path to the optional user pricing override. */
export function pricingOverridePath(): string {
  return path.join(maestroHome(), 'pricing.json')
}

/**
 * Load the pricing table: the user override at `<maestroHome>/pricing.json` when
 * it exists and parses, else the built-in defaults. Never throws — a malformed
 * override logs a warning and falls back to defaults.
 */
export function loadPricing(overridePath: string = pricingOverridePath()): PricingTable {
  try {
    if (fs.existsSync(overridePath)) {
      const raw: unknown = JSON.parse(fs.readFileSync(overridePath, 'utf8'))
      return PricingTableSchema.parse(raw)
    }
  } catch (err) {
    log.warn('pricing.override-invalid', { path: overridePath, message: String(err) })
  }
  return DEFAULT_PRICING
}

/**
 * Persist a user pricing override to `<maestroHome>/pricing.json` (creating the
 * directory if needed) and return the validated table. Validated with the same
 * schema `loadPricing` reads, so a saved table always round-trips.
 */
export function writePricing(
  table: PricingTable,
  overridePath: string = pricingOverridePath()
): PricingTable {
  const validated = PricingTableSchema.parse(table)
  fs.mkdirSync(path.dirname(overridePath), { recursive: true })
  fs.writeFileSync(overridePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  return validated
}
