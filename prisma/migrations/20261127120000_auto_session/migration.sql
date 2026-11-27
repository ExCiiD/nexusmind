-- 27/11/2026 (DECISIONS 27/11): a session started by Ascend when a game begins with no active session.
-- Session.autoStarted: closed by the idle rule, deleted when it never got a game.
-- Session.objectivePromptDismissed: the "add an objective" bubble was dismissed for this session.
ALTER TABLE "Session" ADD COLUMN "autoStarted" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "objectivePromptDismissed" BOOLEAN NOT NULL DEFAULT 0;
