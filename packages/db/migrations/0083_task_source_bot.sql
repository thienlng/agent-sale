-- 0083_task_source_bot: the bot's customer requests leave a staff task (MS-10, MS-21).
--
-- A request recorded by the bot (`record_request`: appointment, placement test, demo, …) opens one
-- task per customer, `source = 'bot'`, due when recorded, so Today lists the requests waiting for
-- staff to confirm; a moved confirmed slot makes it due again as "Khách đổi lịch".
-- Additive only: the check constraint accepts one more value; existing rows already satisfy it.

ALTER TABLE tasks DROP CONSTRAINT tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'today', 'assistant', 'bot'));
