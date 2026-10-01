import 'server-only'
import type { JobRegistry } from '@/integrations/queue/handler'
import { createJobRegistry } from '@/integrations/queue/handler'
import { inviteEmailJob } from '@/server/caregivers/invite-email-job'
import { conversationNudgeJob } from '@/server/conversation/nudge-job'
import { conversationTurnJob } from '@/server/conversation/turn-job'
import { extractDocumentJob } from '@/server/documents/extraction-job'
import { esignWebhookJob } from '@/server/forms/esign-webhook-job'
import { sendEnvelopeJob } from '@/server/forms/send-envelope-job'
import { retentionSweepJob } from '@/server/retention/retention-sweep-job'
import { autoAcceptDocumentJob } from '@/server/review/auto-accept-job'
import { caregiverNoticeJob } from '@/server/review/caregiver-notice-job'
import { judgeDocumentJob } from '@/server/review/judge'
import { alayacareSyncJob } from '@/server/sync/alayacare-sync-job'
import { trainingImportJob } from '@/server/training/training-import-job'
import { staffInviteEmailJob } from '@/server/users/staff-invite-email-job'
import {
  backgroundCheckOrderJob,
  backgroundCheckPollJob,
  backgroundCheckWebhookJob,
} from '@/server/verification/background-check-jobs'
import { referenceChaseJob } from '@/server/verification/reference-jobs'

export const jobRegistry: JobRegistry = createJobRegistry([
  inviteEmailJob,
  extractDocumentJob,
  sendEnvelopeJob,
  esignWebhookJob,
  judgeDocumentJob,
  autoAcceptDocumentJob,
  caregiverNoticeJob,
  alayacareSyncJob,
  backgroundCheckOrderJob,
  backgroundCheckPollJob,
  backgroundCheckWebhookJob,
  staffInviteEmailJob,
  referenceChaseJob,
  trainingImportJob,
  retentionSweepJob,
  conversationTurnJob,
  conversationNudgeJob,
])
