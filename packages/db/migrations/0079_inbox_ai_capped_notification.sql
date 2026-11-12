-- 0079_inbox_ai_capped_notification: the owner alert raised when the AI stops answering anonymous
-- website visitors because a per-site or per-workspace reply cap was reached (security audit
-- 2026-11-12 #2). Additive only: the type list of 0073 plus 'inbox.ai_capped'.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'assistant.report','assistant.alert','assistant.schedule_paused',
  'inbox.handoff','inbox.message','dataexport.ready','dataexport.failed',
  'today.briefing','brain.complaint','task.due','inbox.ai_capped'));
