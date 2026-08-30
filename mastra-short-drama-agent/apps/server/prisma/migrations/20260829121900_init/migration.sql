-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "PromptVersion" ADD COLUMN     "inputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latencyMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'agent',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "changes" TEXT,
ADD COLUMN     "inputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latencyMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "storyBibleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL,
    "age" TEXT,
    "appearance" TEXT NOT NULL,
    "clothing" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "speakingStyle" TEXT NOT NULL,
    "canonicalDescription" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "storyBibleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "lighting" TEXT NOT NULL,
    "colorStyle" TEXT NOT NULL,
    "fixedProps" JSONB NOT NULL,
    "spatialConstraints" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prop" (
    "id" TEXT NOT NULL,
    "storyBibleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appearance" TEXT NOT NULL,
    "owner" TEXT,
    "continuityRules" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "storyBibleId" TEXT NOT NULL,
    "fromEntity" TEXT NOT NULL,
    "toEntity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "storyBibleId" TEXT NOT NULL,
    "sceneNo" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timeLabel" TEXT NOT NULL,
    "participants" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "emotionalChange" TEXT NOT NULL,
    "dramaticPurpose" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeProposal" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "impactScope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT NOT NULL DEFAULT 'agent',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "rating" INTEGER,
    "action" TEXT,
    "comment" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" JSONB NOT NULL,
    "inputRef" TEXT,
    "outputRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Character_storyBibleId_idx" ON "Character"("storyBibleId");

-- CreateIndex
CREATE INDEX "Location_storyBibleId_idx" ON "Location"("storyBibleId");

-- CreateIndex
CREATE INDEX "Prop_storyBibleId_idx" ON "Prop"("storyBibleId");

-- CreateIndex
CREATE INDEX "Relationship_storyBibleId_idx" ON "Relationship"("storyBibleId");

-- CreateIndex
CREATE INDEX "TimelineEvent_storyBibleId_idx" ON "TimelineEvent"("storyBibleId");

-- CreateIndex
CREATE INDEX "TimelineEvent_storyBibleId_sceneNo_sequence_idx" ON "TimelineEvent"("storyBibleId", "sceneNo", "sequence");

-- CreateIndex
CREATE INDEX "ChangeProposal_targetType_targetId_idx" ON "ChangeProposal"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ChangeProposal_status_idx" ON "ChangeProposal"("status");

-- CreateIndex
CREATE INDEX "Feedback_targetType_targetId_idx" ON "Feedback"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "DomainTask_kind_status_idx" ON "DomainTask"("kind", "status");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_storyBibleId_fkey" FOREIGN KEY ("storyBibleId") REFERENCES "StoryBible"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_storyBibleId_fkey" FOREIGN KEY ("storyBibleId") REFERENCES "StoryBible"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prop" ADD CONSTRAINT "Prop_storyBibleId_fkey" FOREIGN KEY ("storyBibleId") REFERENCES "StoryBible"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_storyBibleId_fkey" FOREIGN KEY ("storyBibleId") REFERENCES "StoryBible"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_storyBibleId_fkey" FOREIGN KEY ("storyBibleId") REFERENCES "StoryBible"("id") ON DELETE CASCADE ON UPDATE CASCADE;
