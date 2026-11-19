import { useCollab } from '@/hooks/useCollab'
import { isLegacyStaff } from '@/lib/permissions'

/**
 * #40: who edits the analyst screens of a group. Staff and analysts (owner / coach / analyst, main or staff role,
 * #39) write the draft log notes and the dossiers; players read (§ 11, § 12).
 */
export function useAnalystCanEdit(groupId: string | null | undefined): boolean {
  const { groups } = useCollab()
  const g = groupId ? groups.find((x) => x.id === groupId) : undefined
  return !!g && isLegacyStaff(g.myRole, g.myStaffRoles)
}
