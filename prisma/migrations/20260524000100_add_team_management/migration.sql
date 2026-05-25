-- Team management: roster, champion pool, draft prep, opponent scouting

CREATE TABLE "Team" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tag" TEXT,
  "logo" TEXT,
  "notes" TEXT,
  "isOpponent" BOOLEAN NOT NULL DEFAULT false,
  "scoutNotes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Team_userId_idx" ON "Team"("userId");

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "teamId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "ign" TEXT,
  "tagLine" TEXT,
  "region" TEXT,
  "role" TEXT NOT NULL,
  "puuid" TEXT,
  CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

CREATE TABLE "ChampionPoolEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "memberId" TEXT NOT NULL,
  "championKey" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "tier" TEXT NOT NULL DEFAULT 'comfort',
  "notes" TEXT,
  "playRate" INTEGER,
  "winRate" INTEGER,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ChampionPoolEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ChampionPoolEntry_memberId_role_idx" ON "ChampionPoolEntry"("memberId", "role");
CREATE UNIQUE INDEX "ChampionPoolEntry_memberId_championKey_role_key" ON "ChampionPoolEntry"("memberId", "championKey", "role");

CREATE TABLE "DraftPrep" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vsTeamId" TEXT,
  "bluePicks" TEXT NOT NULL DEFAULT '[]',
  "blueBans" TEXT NOT NULL DEFAULT '[]',
  "redPicks" TEXT NOT NULL DEFAULT '[]',
  "redBans" TEXT NOT NULL DEFAULT '[]',
  "myTeamSide" TEXT NOT NULL DEFAULT 'blue',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DraftPrep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DraftPrep_vsTeamId_fkey" FOREIGN KEY ("vsTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DraftPrep_userId_idx" ON "DraftPrep"("userId");
