import { z } from 'zod'
import type {
  MedicalAnswerInput,
  MedicalResponse,
  MedicalScreeningItem,
  MedicalScreeningOutcome,
  MedicalScreeningResultInput,
  MedicalSection,
} from '@/domain/medical/screening'
import {
  MEDICAL_SECTION_FIELD_NAMES,
  SCREENING_RESULTS_FIELD_NAME,
  medicalAnswerInputSchema,
  medicalScreeningResultInputSchema,
} from '@/domain/medical/screening'
import type { AuditedTx } from '../audit'
import { runInAuditedTransaction, writeAuditEntry } from '../audit'
import { fromDateColumn, toDateColumn } from '../mapping/date-only'
import type { PrismaTransactionClient } from '../prisma'

// AuditedTx omits the restricted delegates so that no use case outside this directory can
// reach the medical or EEOC store (ADR-002). These accessors are the one place that may, so
// they widen it here; the widened type is not exported and cannot travel.
type RestrictedTx = PrismaTransactionClient & AuditedTx

export type MedicalFileRow = {
  id: string
  agencyId: string
  caregiverId: string
  createdAt: Date
  updatedAt: Date
}

export async function deleteMedicalFile(agencyId: string, caregiverId: string): Promise<void> {
  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    // No foreign key joins the three tables, so the whole file is deleted here or not at all.
    await tx.medicalAnswer.deleteMany({ where: { agencyId, caregiverId } })
    await tx.medicalScreeningResult.deleteMany({ where: { agencyId, caregiverId } })
    await tx.clinicalDocumentText.deleteMany({ where: { agencyId, caregiverId } })
    await tx.clinicalJudgeReasons.deleteMany({ where: { agencyId, caregiverId } })
    await tx.medicalFile.deleteMany({ where: { agencyId, caregiverId } })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'DELETE',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
    })
  })
}

export type MedicalAnswerRow = {
  section: MedicalSection
  questionKey: string
  response: MedicalResponse
  detail: string | null
}

/** Everything that leaves the medical store for clearance: the item, pass or fail, and the day. */
export type MedicalScreeningResultView = {
  item: MedicalScreeningItem
  outcome: MedicalScreeningOutcome
  resultedOn: string
}

export function readMedicalAnswers(
  agencyId: string,
  caregiverId: string,
  section: MedicalSection,
): Promise<readonly MedicalAnswerRow[]> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const rows = await tx.medicalAnswer.findMany({
      where: { agencyId, caregiverId, section },
      select: { section: true, questionKey: true, response: true, detail: true },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: MEDICAL_SECTION_FIELD_NAMES[section],
    })
    return rows
  })
}

/** Replaces the whole section: a question dropped from the form must not leave a stale answer. */
export async function saveMedicalAnswers(
  agencyId: string,
  caregiverId: string,
  section: MedicalSection,
  answers: readonly MedicalAnswerInput[],
): Promise<void> {
  const parsed = z.array(medicalAnswerInputSchema).parse(answers)

  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    // caregiverId is unique on its own, so the root is found by both keys rather than upserted
    // on caregiverId alone, which could reach another agency's row.
    const root = await tx.medicalFile.findFirst({ where: { agencyId, caregiverId } })
    if (root === null) await tx.medicalFile.create({ data: { agencyId, caregiverId } })

    await tx.medicalAnswer.deleteMany({ where: { agencyId, caregiverId, section } })
    await tx.medicalAnswer.createMany({
      data: parsed.map((answer) => ({ agencyId, caregiverId, section, ...answer })),
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: MEDICAL_SECTION_FIELD_NAMES[section],
    })
  })
}

/**
 * The one read that leaves the store, for transcription into a requirement instance (T-083).
 * An item with no recorded outcome is absent, never PENDING.
 */
export function readMedicalClearanceResults(
  agencyId: string,
  caregiverId: string,
): Promise<readonly MedicalScreeningResultView[]> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const rows = await tx.medicalScreeningResult.findMany({
      where: { agencyId, caregiverId },
      select: { item: true, outcome: true, resultedOn: true },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: SCREENING_RESULTS_FIELD_NAME,
    })
    return rows.map((row) => ({
      item: row.item,
      outcome: row.outcome,
      resultedOn: fromDateColumn(row.resultedOn),
    }))
  })
}

/** A re-test overwrites the outcome; its history is the audit log's EDIT entries. */
export async function recordMedicalScreeningResult(
  agencyId: string,
  caregiverId: string,
  result: MedicalScreeningResultInput,
): Promise<void> {
  const { item, outcome, resultedOn } = medicalScreeningResultInputSchema.parse(result)
  const data = { outcome, resultedOn: toDateColumn(resultedOn) }

  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const root = await tx.medicalFile.findFirst({ where: { agencyId, caregiverId } })
    if (root === null) await tx.medicalFile.create({ data: { agencyId, caregiverId } })

    await tx.medicalScreeningResult.upsert({
      where: { agencyId_caregiverId_item: { agencyId, caregiverId, item } },
      create: { agencyId, caregiverId, item, ...data },
      update: data,
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: SCREENING_RESULTS_FIELD_NAME,
    })
  })
}

const CLINICAL_DOCUMENT_TEXT_FIELD_NAME = 'clinicalDocumentText'

/** The OCR text of a clinic result (ADR-082). A second save for one document replaces it. */
export async function saveClinicalDocumentText(
  agencyId: string,
  caregiverId: string,
  uploadedDocumentId: string,
  text: string,
): Promise<void> {
  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const root = await tx.medicalFile.findFirst({ where: { agencyId, caregiverId } })
    if (root === null) await tx.medicalFile.create({ data: { agencyId, caregiverId } })

    await tx.clinicalDocumentText.upsert({
      where: { agencyId_uploadedDocumentId: { agencyId, uploadedDocumentId } },
      create: { agencyId, caregiverId, uploadedDocumentId, text },
      update: { text },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: CLINICAL_DOCUMENT_TEXT_FIELD_NAME,
    })
  })
}

export function readClinicalDocumentText(
  agencyId: string,
  caregiverId: string,
  uploadedDocumentId: string,
): Promise<string | null> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const row = await tx.clinicalDocumentText.findFirst({
      where: { agencyId, caregiverId, uploadedDocumentId },
      select: { text: true },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: CLINICAL_DOCUMENT_TEXT_FIELD_NAME,
    })
    return row?.text ?? null
  })
}

const CLINICAL_JUDGE_REASONS_FIELD_NAME = 'clinicalJudgeReasons'

/** The judge's reasons about a clinic result; they quote clinical text (ADR-098). */
export async function saveClinicalJudgeReasons(
  agencyId: string,
  caregiverId: string,
  uploadedDocumentId: string,
  reasons: readonly string[],
): Promise<void> {
  await runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const root = await tx.medicalFile.findFirst({ where: { agencyId, caregiverId } })
    if (root === null) await tx.medicalFile.create({ data: { agencyId, caregiverId } })

    await tx.clinicalJudgeReasons.upsert({
      where: { agencyId_uploadedDocumentId: { agencyId, uploadedDocumentId } },
      create: { agencyId, caregiverId, uploadedDocumentId, reasons: [...reasons] },
      update: { reasons: [...reasons] },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'EDIT',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: CLINICAL_JUDGE_REASONS_FIELD_NAME,
    })
  })
}

export function readClinicalJudgeReasons(
  agencyId: string,
  caregiverId: string,
  uploadedDocumentId: string,
): Promise<readonly string[] | null> {
  return runInAuditedTransaction(async (audited) => {
    const tx = audited as RestrictedTx
    const row = await tx.clinicalJudgeReasons.findFirst({
      where: { agencyId, caregiverId, uploadedDocumentId },
      select: { reasons: true },
    })
    await writeAuditEntry(tx, {
      agencyId,
      action: 'VIEW',
      entityType: 'MEDICAL_FILE',
      entityId: caregiverId,
      fieldName: CLINICAL_JUDGE_REASONS_FIELD_NAME,
    })
    return row?.reasons ?? null
  })
}
