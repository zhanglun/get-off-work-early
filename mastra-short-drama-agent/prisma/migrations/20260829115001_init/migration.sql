-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "beats" JSONB,
ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "conflict" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "continuityNotes" JSONB,
ADD COLUMN     "emotionalArc" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "objective" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "planningStatus" TEXT NOT NULL DEFAULT 'proposed',
ADD COLUMN     "sourceRefs" JSONB;
