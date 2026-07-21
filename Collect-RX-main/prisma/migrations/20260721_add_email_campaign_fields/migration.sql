-- Add email campaign tracking fields to Prospect table
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email_sequence_step INTEGER DEFAULT 0;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS initial_email_sent_at TIMESTAMP;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS follow_up_email_sent_at TIMESTAMP;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS follow_up_scheduled_for TIMESTAMP;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email_replied_at TIMESTAMP;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email_bounce_reason TEXT;

-- Create index for email scheduling queries
CREATE INDEX IF NOT EXISTS idx_prospects_follow_up_scheduled ON prospects(follow_up_scheduled_for) WHERE follow_up_scheduled_for IS NOT NULL AND follow_up_scheduled_for < NOW();

-- Create index for finding prospects to email
CREATE INDEX IF NOT EXISTS idx_prospects_email_sequence ON prospects(email_sequence_step, stage);

-- Create EmailCampaignEvent table for tracking sent/opened/replied/bounced
CREATE TABLE IF NOT EXISTS email_campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed')),
  event_timestamp TIMESTAMP DEFAULT NOW(),
  email_subject TEXT,
  reply_body TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_prospect ON email_campaign_events(prospect_id);
CREATE INDEX IF NOT EXISTS idx_email_events_timestamp ON email_campaign_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_campaign_events(event_type);
