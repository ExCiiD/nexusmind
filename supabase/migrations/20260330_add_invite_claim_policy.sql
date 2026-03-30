-- Allow any authenticated user to claim a pending invite (become the coach).
-- The app code validates the invite code and prevents self-redemption.
-- Pending rows have coach_id = student_id as a placeholder until redeemed.
create policy "coach_students_invite_claim" on public.coach_students
  for update using (status = 'pending' and coach_id = student_id);
