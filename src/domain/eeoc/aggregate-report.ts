import {
  EEOC_GENDERS,
  EEOC_RACE_ETHNICITIES,
  type EeocGender,
  type EeocRaceEthnicity,
} from './self-identification'

export const EEOC_GENDER_CELLS = [...EEOC_GENDERS, 'NOT_ANSWERED'] as const
export const EEOC_RACE_ETHNICITY_CELLS = [...EEOC_RACE_ETHNICITIES, 'NOT_ANSWERED'] as const
export type EeocGenderCell = (typeof EEOC_GENDER_CELLS)[number]
export type EeocRaceEthnicityCell = (typeof EEOC_RACE_ETHNICITY_CELLS)[number]

/** One row of the store's own gender × race tally. Never leaves src/db/restricted/. */
type EeocResponseTally = {
  readonly gender: EeocGender | null
  readonly raceEthnicity: EeocRaceEthnicity | null
  readonly count: number
}

export type ReportedCell = { readonly suppressed: false; readonly count: number } | { readonly suppressed: true }

export type EeocAggregateReport =
  | { readonly status: 'WITHHELD' }
  | {
      readonly status: 'REPORTED'
      readonly respondents: number
      readonly gender: Readonly<Record<EeocGenderCell, ReportedCell>>
      readonly raceEthnicity: Readonly<Record<EeocRaceEthnicityCell, ReportedCell>>
    }

// SECURITY.md: the aggregate report "refuses to return a group smaller than 5".
const MINIMUM = 5

function suppress<C extends string>(cells: readonly C[], counts: ReadonlyMap<C, number>): Record<C, ReportedCell> {
  const count = (cell: C) => counts.get(cell) ?? 0
  const hidden = new Set(cells.filter((cell) => count(cell) < MINIMUM))
  const hiddenTotal = () => [...hidden].reduce((sum, cell) => sum + count(cell), 0)

  // The total is published, so a lone hidden cell, or hidden cells holding fewer than five
  // between them, could be worked out by subtraction; hide the next-smallest cell until neither holds.
  while (hidden.size > 0 && (hidden.size === 1 || hiddenTotal() < MINIMUM)) {
    const shown = cells.filter((cell) => !hidden.has(cell))
    const smallest = shown.reduce((min, cell) => (count(cell) < count(min) ? cell : min))
    hidden.add(smallest)
  }

  return Object.fromEntries(
    cells.map((cell) => [cell, hidden.has(cell) ? { suppressed: true } : { suppressed: false, count: count(cell) }]),
  ) as Record<C, ReportedCell>
}

export function buildEeocAggregateReport(tallies: readonly EeocResponseTally[]): EeocAggregateReport {
  const gender = new Map<EeocGenderCell, number>()
  const raceEthnicity = new Map<EeocRaceEthnicityCell, number>()
  let respondents = 0
  for (const tally of tallies) {
    const genderCell = tally.gender ?? 'NOT_ANSWERED'
    const raceCell = tally.raceEthnicity ?? 'NOT_ANSWERED'
    gender.set(genderCell, (gender.get(genderCell) ?? 0) + tally.count)
    raceEthnicity.set(raceCell, (raceEthnicity.get(raceCell) ?? 0) + tally.count)
    respondents += tally.count
  }

  if (respondents < MINIMUM) return { status: 'WITHHELD' }
  return {
    status: 'REPORTED',
    respondents,
    gender: suppress(EEOC_GENDER_CELLS, gender),
    raceEthnicity: suppress(EEOC_RACE_ETHNICITY_CELLS, raceEthnicity),
  }
}
