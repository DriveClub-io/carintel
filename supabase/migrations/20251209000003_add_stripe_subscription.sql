-- =============================================
-- ADD STRIPE SUBSCRIPTION TRACKING
-- =============================================

-- Add stripe_subscription_id to organizations
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);

-- Add index for subscription lookup
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription ON organizations(stripe_subscription_id);

-- Update subscription_tiers with Stripe price IDs
-- These should be set to your actual Stripe price IDs after creating products in Stripe
UPDATE subscription_tiers SET stripe_price_id = 'price_free' WHERE id = 'free';
UPDATE subscription_tiers SET stripe_price_id = 'price_starter' WHERE id = 'starter';
UPDATE subscription_tiers SET stripe_price_id = 'price_pro' WHERE id = 'pro';
UPDATE subscription_tiers SET stripe_price_id = 'price_enterprise' WHERE id = 'enterprise';
