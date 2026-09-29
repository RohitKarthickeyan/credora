import { z } from 'zod'

// The client's own view of the AlayaCare employees API (v2), declared independently of
// mock-servers/ so a drift between the two fails the round-trip tests (ADR-048).

export type Demographics = Record<string, string | null>

export type EmployeeWrite = {
  readonly demographics: Demographics
  readonly external_id?: string
}

export type EmployeeSkillWrite = {
  readonly employee_id: number
  readonly skill_id: number
  readonly start_at?: string
  readonly expiry_date?: string
  readonly label1?: string
  readonly label2?: string
  readonly comments?: string
}

function paged<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: z.number().int(), total_pages: z.number().int() })
}

export const employeeListSchema = paged(
  z.object({
    id: z.number().int(),
    external_id: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  }),
)
export type EmployeeListItem = z.infer<typeof employeeListSchema>['items'][number]

export const employeeSchema = z.object({
  id: z.number().int(),
  demographics: z.object({
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().nullish(),
    birthday: z.iso.date().nullish(),
    phone: z.string().nullish(),
    hire_date: z.iso.date().nullish(),
  }),
})
export type Employee = z.infer<typeof employeeSchema>

export const employeeWrittenSchema = z.object({ id: z.number().int() })

export const profileAttributesSchema = paged(z.object({ tag: z.string() }))

export const skillsSchema = paged(z.object({ id: z.number().int() }))

export const employeeSkillsSchema = paged(
  z.object({
    id: z.number().int(),
    skill_id: z.number().int(),
    date_value: z.number().int().nullable(),
    acquired_date_value: z.iso.date().nullable(),
    label_1_value: z.string().nullable(),
    label_2_value: z.string().nullable(),
  }),
)

export const employeeSkillCreatedSchema = z.object({ id: z.number().int() })

export const attachmentCreatedSchema = z.object({ name: z.string().min(1) })

export const errorSchema = z.object({ code: z.number().int(), message: z.string() })
