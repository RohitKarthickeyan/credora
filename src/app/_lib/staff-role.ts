import type { StaffRole } from '@/domain/auth/staff-user'

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  COORDINATOR: 'Coordinator',
  SUPERVISOR: 'Clinical supervisor',
  AGENCY_ADMIN: 'Agency admin',
  IMPLEMENTATION: 'Implementation (Credora)',
}
