import { z } from 'zod'

export const profileAttributeSchema = z.object({
  tag: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['text', 'date', 'boolean']),
})
export type ProfileAttribute = z.infer<typeof profileAttributeSchema>

export const skillSchema = z.object({
  id: z.number().int(),
  description: z.string().min(1),
  label1: z.string().min(1),
  label2: z.string().min(1),
  has_date: z.boolean(),
  has_acquired_date: z.boolean(),
})
export type Skill = z.infer<typeof skillSchema>

export const seedEmployeeSchema = z.object({
  id: z.number().int(),
  external_id: z.string().min(1).nullable(),
  status: z.string().min(1),
  demographics: z.record(z.string(), z.string()),
})
export type SeedEmployee = z.infer<typeof seedEmployeeSchema>

const externalId = z.string().min(1).nullable().optional()
const demographics = z.record(z.string(), z.unknown())

export const employeeCreateSchema = z.object({ demographics, external_id: externalId })

export const employeeUpdateSchema = z.object({ demographics: demographics.optional(), external_id: externalId })

export const employeeSkillCreateSchema = z.object({
  employee_id: z.number().int(),
  skill_id: z.number().int(),
  start_at: z.iso.date().optional(),
  expiry_date: z.iso.datetime().optional(),
  label1: z.string().optional(),
  label2: z.string().optional(),
  label3: z.string().optional(),
  comments: z.string().optional(),
})
