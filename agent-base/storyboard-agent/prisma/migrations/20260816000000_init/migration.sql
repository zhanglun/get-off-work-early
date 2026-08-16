-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "taskCenterId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sceneNo" INTEGER NOT NULL,
    "scriptExcerpt" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "draft" JSONB,
    "finalPrompt" TEXT,
    "rationale" TEXT,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OldShot" (
    "id" TEXT NOT NULL,
    "taskCenterId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "legacyPrompt" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OldShot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "findings" JSONB NOT NULL,
    "changes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "rater" TEXT NOT NULL,
    "winner" TEXT NOT NULL,
    "scoreNew" INTEGER NOT NULL,
    "scoreOld" INTEGER NOT NULL,
    "sideOrder" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindTestOrder" (
    "id" TEXT NOT NULL,
    "taskCenterId" TEXT NOT NULL,
    "sideOrder" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlindTestOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCard" (
    "id" TEXT NOT NULL,
    "taskCenterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shot_taskCenterId_idx" ON "Shot"("taskCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_taskCenterId_seq_key" ON "Shot"("taskCenterId", "seq");

-- CreateIndex
CREATE INDEX "OldShot_taskCenterId_idx" ON "OldShot"("taskCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "OldShot_taskCenterId_seq_key" ON "OldShot"("taskCenterId", "seq");

-- CreateIndex
CREATE INDEX "ReviewLog_shotId_idx" ON "ReviewLog"("shotId");

-- CreateIndex
CREATE INDEX "Score_shotId_idx" ON "Score"("shotId");

-- CreateIndex
CREATE UNIQUE INDEX "Score_shotId_rater_key" ON "Score"("shotId", "rater");

-- CreateIndex
CREATE UNIQUE INDEX "BlindTestOrder_taskCenterId_key" ON "BlindTestOrder"("taskCenterId");

-- CreateIndex
CREATE INDEX "CharacterCard_taskCenterId_idx" ON "CharacterCard"("taskCenterId");

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

