CREATE TABLE "marketing_campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "target_provinces" JSONB,
  "harvest_query" TEXT,
  "max_prospects" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "prospects" ADD COLUMN "campaign_id" TEXT;
ALTER TABLE "prospects" ADD COLUMN "linked_practice_id" TEXT;
ALTER TABLE "prospects" ADD COLUMN "demo_scheduled_at" TIMESTAMP(3);
ALTER TABLE "prospects" ADD COLUMN "pre_demo_email_sent_at" TIMESTAMP(3);
ALTER TABLE "prospects" ADD COLUMN "dncl_checked_at" TIMESTAMP(3);
ALTER TABLE "prospects" ADD COLUMN "dncl_listed" BOOLEAN;
ALTER TABLE "prospects" ADD COLUMN "hubspot_deal_id" TEXT;

CREATE UNIQUE INDEX "prospects_linked_practice_id_key" ON "prospects"("linked_practice_id");
CREATE INDEX "prospects_campaign_id_idx" ON "prospects"("campaign_id");

ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "prospects" ADD CONSTRAINT "prospects_linked_practice_id_fkey"
  FOREIGN KEY ("linked_practice_id") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
