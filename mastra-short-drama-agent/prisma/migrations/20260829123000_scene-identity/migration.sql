-- Scene identity is scoped to a StoryBible snapshot, not only the episode.
DROP INDEX IF EXISTS "Scene_episodeId_sceneNo_key";
CREATE INDEX IF NOT EXISTS "Scene_episodeId_idx" ON "Scene"("episodeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Scene_storyBibleId_sceneNo_key" ON "Scene"("storyBibleId", "sceneNo");
