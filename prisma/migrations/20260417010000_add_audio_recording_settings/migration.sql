-- Audio recording settings: desktop loopback + microphone capture
ALTER TABLE "User" ADD COLUMN "recordAudioDesktop" BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "recordAudioDesktopDevice" TEXT;
ALTER TABLE "User" ADD COLUMN "recordAudioMic" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "recordAudioMicDevice" TEXT;
