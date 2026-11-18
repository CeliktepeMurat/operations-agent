-- Refunds are recorded as 'pending' before the payment provider is called,
-- so a crash mid-refund leaves evidence instead of untracked money.
ALTER TABLE refunds DROP CONSTRAINT refunds_status_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_status_check
  CHECK (status IN ('pending', 'completed', 'failed'));
