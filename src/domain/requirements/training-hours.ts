const TRAINING_CATEGORIES = ['ORIENTATION', 'IN_SERVICE'] as const
type TrainingCategory = (typeof TRAINING_CATEGORIES)[number]

const COURSE_PREFIXES: Readonly<Record<TrainingCategory, string>> = {
  ORIENTATION: 'ORIENT-',
  IN_SERVICE: 'INSVC-',
}

// OPEN-QUESTIONS 247: the platform labels no category, so the course-code prefix decides,
// case-sensitively. A code matching neither counts toward nothing.
export function classifyCourse(courseCode: string): TrainingCategory | null {
  return TRAINING_CATEGORIES.find((category) => courseCode.startsWith(COURSE_PREFIXES[category])) ?? null
}

export const TRAINING_EVIDENCE_KEYS: Readonly<Record<TrainingCategory, string>> = {
  ORIENTATION: 'ORIENTATION_RECORD',
  IN_SERVICE: 'IN_SERVICE_HOURS',
}

export type TrainingCompletionFact = {
  readonly id: string
  readonly courseCode: string
  readonly completedOn: string
  readonly minutes: number
}

export type TrainingRequirementFact = {
  readonly minimumMinutes: number | null
  /** evidenceKeys of the pinned template's TRAINING_RECORD accepted-evidence options */
  readonly trainingEvidenceKeys: readonly string[]
}

type TrainingStanding = {
  readonly category: TrainingCategory
  readonly minimumMinutes: number | null
  readonly completedMinutes: number
  readonly shortfallMinutes: number
  readonly met: boolean
  readonly countedCompletionIds: readonly string[]
}

/**
 * No minimum: any one completion of the category, ever, meets it. A minimum: the category's
 * minutes from 1 January of `asOf`'s UTC year through `asOf`, inclusive, must reach it
 * (OPEN-QUESTIONS 248). Null when the template accepts no key this rule feeds.
 */
export function evaluateTrainingRequirement(
  requirement: TrainingRequirementFact,
  completions: readonly TrainingCompletionFact[],
  asOf: Date,
): TrainingStanding | null {
  const category = TRAINING_CATEGORIES.find((candidate) =>
    requirement.trainingEvidenceKeys.includes(TRAINING_EVIDENCE_KEYS[candidate]),
  )
  if (category === undefined) return null

  const { minimumMinutes } = requirement
  const through = asOf.toISOString().slice(0, 10)
  const from = `${through.slice(0, 4)}-01-01`
  const counted = completions.filter(
    (completion) =>
      classifyCourse(completion.courseCode) === category &&
      (minimumMinutes === null ||
        (completion.completedOn >= from && completion.completedOn <= through)),
  )
  const completedMinutes = counted.reduce((sum, completion) => sum + completion.minutes, 0)

  const met = minimumMinutes === null ? counted.length > 0 : completedMinutes >= minimumMinutes
  return {
    category,
    minimumMinutes,
    completedMinutes,
    shortfallMinutes: minimumMinutes === null ? 0 : Math.max(minimumMinutes - completedMinutes, 0),
    met,
    countedCompletionIds: counted.map((completion) => completion.id),
  }
}
