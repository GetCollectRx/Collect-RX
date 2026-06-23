CREATE TABLE "marketing_score_config" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "weights" JSONB NOT NULL,
  "stats" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_score_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing_learning_runs" (
  "id" TEXT NOT NULL,
  "wins" INTEGER NOT NULL,
  "losses" INTEGER NOT NULL,
  "prospects_rescored" INTEGER NOT NULL,
  "weights_before" JSONB NOT NULL,
  "weights_after" JSONB NOT NULL,
  "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "marketing_learning_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marketing_learning_runs_created_at_idx" ON "marketing_learning_runs"("created_at");

INSERT INTO "marketing_score_config" ("id", "weights", "stats", "updated_at")
VALUES (
  'default',
  '{"base":40,"hasPhone":20,"hasWebsite":15,"hasEmail":5,"ratingGte4":10,"ratingGte45":5,"sourceReferral":15,"sourceHarvest":0,"hasPmsHint":5}'::jsonb,
  '{"version":1,"note":"default weights"}'::jsonb,
  CURRENT_TIMESTAMP
);
