import { z } from 'zod'

// Latin letters that NFKD does not decompose, so without this map two spellings of the same
// Scandinavian or German surname never key to the same string.
const LATIN_FOLD: Record<string, string> = {
  ø: 'o', Ø: 'o',
  æ: 'ae', Æ: 'ae',
  œ: 'oe', Œ: 'oe',
  ß: 'ss', ẞ: 'ss',
  đ: 'd', Đ: 'd',
  ł: 'l', Ł: 'l',
  ð: 'd', Ð: 'd',
  þ: 'th', Þ: 'th',
}

const SUFFIX_ALIASES: Record<string, string> = { '2nd': 'ii', '3rd': 'iii', '4th': 'iv' }

const GENERATIONAL_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

const nameTextSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .refine((value) => value.length > 0, { error: 'Enter a name.' })
  .refine((value) => value.length <= 100, { error: 'That name is too long.' })

// The stored value is the legal name: a W-4, an I-9 §1 and a CHRC-102 must carry it exactly as
// written, so this schema folds no case and strips no accent, apostrophe or suffix.
export const personNameSchema = z.object({
  first: nameTextSchema,
  middle: nameTextSchema.optional(),
  last: nameTextSchema,
  suffix: nameTextSchema.optional(),
})

export type PersonName = z.infer<typeof personNameSchema>

export type NormalizedName = { first: string; middle: string; last: string; full: string }

/**
 * Comparison key for identity matching (T-072). Lossy — never write the result back to the
 * record. Particles (van, der, de, la, …) are deliberately kept, so a document that omits one
 * fails the comparison and lands in the exception queue rather than matching a stranger.
 */
export function normalizeName(value: string): string {
  const folded = Array.from(value.normalize('NFKD').replace(/\p{M}/gu, ''))
    .map((char) => LATIN_FOLD[char] ?? char)
    .join('')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/\./g, '')
    .replace(/[-–—,]/g, ' ')

  const tokens = folded.split(/\s+/).filter((token) => token.length > 0)
  const final = tokens[tokens.length - 1]

  // At least two tokens must precede the suffix, so the middle initial in 'John V' is kept.
  if (tokens.length >= 3 && final !== undefined) {
    const canonical = SUFFIX_ALIASES[final] ?? final

    if (GENERATIONAL_SUFFIXES.has(canonical)) {
      return tokens.slice(0, -1).join(' ')
    }
  }

  return tokens.join(' ')
}

export function normalizeNameForMatch(name: PersonName): NormalizedName {
  const first = normalizeName(name.first)
  const last = normalizeName(name.last)

  return {
    first,
    middle: name.middle === undefined ? '' : normalizeName(name.middle),
    last,
    // Documents inconsistently carry a middle name, so `full` omits it.
    full: `${first} ${last}`,
  }
}
