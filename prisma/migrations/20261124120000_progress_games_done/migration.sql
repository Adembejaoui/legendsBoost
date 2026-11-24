-- Net Win Boost and Placement Boost progress (client PDFs 2026-11-24): the
-- booster posts the games done so far (net wins / placement games played),
-- shown as 0/5 -> 5/5. Null on rank updates.
ALTER TABLE "orderProgressUpdate" ADD COLUMN "gamesDone" INTEGER;
