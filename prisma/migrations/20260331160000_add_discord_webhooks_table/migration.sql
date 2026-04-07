CREATE TABLE "DiscordWebhook" (
  "id"        TEXT     NOT NULL PRIMARY KEY,
  "userId"    TEXT     NOT NULL,
  "name"      TEXT     NOT NULL,
  "url"       TEXT     NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscordWebhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DiscordWebhook_userId_idx" ON "DiscordWebhook"("userId");

-- Migrate any existing single webhook to the new table (OR IGNORE makes this re-run safe)
INSERT OR IGNORE INTO "DiscordWebhook" ("id", "userId", "name", "url", "createdAt")
SELECT 'migrated_' || id, id, 'Default', discordWebhookUrl, CURRENT_TIMESTAMP
FROM "User"
WHERE discordWebhookUrl IS NOT NULL AND discordWebhookUrl != '';
