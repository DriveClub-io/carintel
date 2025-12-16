-- =============================================
-- PERFORMANCE OPTIMIZATIONS FOR AUTOCOMPLETE API
-- =============================================

-- =============================================
-- 1. Enable pg_trgm extension for fast ILIKE searches
-- =============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- 2. Add trigram indexes for vehicle_specs search
-- These indexes support fast ILIKE pattern matching
-- =============================================
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_make_trgm
ON vehicle_specs USING gin(make gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vehicle_specs_model_trgm
ON vehicle_specs USING gin(model gin_trgm_ops);

-- Combined index for display_text search (year + make + model)
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_year_make_model
ON vehicle_specs(year DESC, make, model);

-- =============================================
-- 3. Create fast validate_api_key function (no last_used_at update)
-- This removes the write operation that was slowing down every request
-- =============================================
CREATE OR REPLACE FUNCTION validate_api_key_fast(p_key_hash VARCHAR(64))
RETURNS TABLE(
    api_key_id UUID,
    organization_id UUID,
    org_name VARCHAR(200),
    tier_id VARCHAR(20),
    rate_limit INTEGER,
    monthly_limit INTEGER,
    is_valid BOOLEAN,
    rejection_reason VARCHAR(100)
) AS $$
DECLARE
    v_key_record RECORD;
    v_org_record RECORD;
    v_tier_record RECORD;
    v_current_usage BIGINT;
BEGIN
    -- Find the API key (uses idx_api_keys_hash index)
    SELECT * INTO v_key_record
    FROM api_keys ak
    WHERE ak.key_hash = p_key_hash;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            NULL::UUID, NULL::UUID, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'invalid_key'::VARCHAR(100);
        RETURN;
    END IF;

    -- Check if key is active
    IF NOT v_key_record.is_active THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'key_disabled'::VARCHAR(100);
        RETURN;
    END IF;

    -- Check if key is expired
    IF v_key_record.expires_at IS NOT NULL AND v_key_record.expires_at < NOW() THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, NULL::VARCHAR(200), NULL::VARCHAR(20),
            NULL::INTEGER, NULL::INTEGER, false, 'key_expired'::VARCHAR(100);
        RETURN;
    END IF;

    -- Get organization
    SELECT * INTO v_org_record
    FROM organizations o
    WHERE o.id = v_key_record.organization_id;

    -- Check subscription status
    IF v_org_record.subscription_status != 'active' AND v_org_record.subscription_status != 'trialing' THEN
        RETURN QUERY SELECT
            v_key_record.id, v_key_record.organization_id, v_org_record.name, v_org_record.subscription_tier_id,
            NULL::INTEGER, NULL::INTEGER, false, 'subscription_inactive'::VARCHAR(100);
        RETURN;
    END IF;

    -- Get tier info
    SELECT * INTO v_tier_record
    FROM subscription_tiers st
    WHERE st.id = v_org_record.subscription_tier_id;

    -- Check monthly usage limit
    IF v_tier_record.monthly_token_limit IS NOT NULL THEN
        SELECT total_tokens INTO v_current_usage
        FROM get_org_monthly_usage(v_key_record.organization_id);

        IF v_current_usage >= v_tier_record.monthly_token_limit THEN
            RETURN QUERY SELECT
                v_key_record.id, v_key_record.organization_id, v_org_record.name, v_org_record.subscription_tier_id,
                COALESCE(v_key_record.rate_limit_override, v_tier_record.rate_limit_per_minute),
                v_tier_record.monthly_token_limit,
                false, 'quota_exceeded'::VARCHAR(100);
            RETURN;
        END IF;
    END IF;

    -- NOTE: Removed UPDATE api_keys SET last_used_at = NOW()
    -- This was causing a write on every request, slowing down the API
    -- last_used_at can be updated asynchronously via usage_logs if needed

    -- Return success
    RETURN QUERY SELECT
        v_key_record.id,
        v_key_record.organization_id,
        v_org_record.name,
        v_org_record.subscription_tier_id,
        COALESCE(v_key_record.rate_limit_override, v_tier_record.rate_limit_per_minute),
        v_tier_record.monthly_token_limit,
        true,
        NULL::VARCHAR(100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 4. Create materialized view for fast autocomplete
-- Pre-computed distinct year/make/model combinations
-- =============================================
DROP MATERIALIZED VIEW IF EXISTS vehicle_autocomplete;

CREATE MATERIALIZED VIEW vehicle_autocomplete AS
SELECT DISTINCT
    year,
    make,
    model,
    (year::text || ' ' || make || ' ' || model) as display_text,
    -- Get one sample_vin per year/make/model combo
    (SELECT sample_vin FROM vehicle_specs vs2
     WHERE vs2.year = vs.year AND vs2.make = vs.make AND vs2.model = vs.model
     AND vs2.sample_vin IS NOT NULL
     LIMIT 1) as sample_vin
FROM vehicle_specs vs
ORDER BY year DESC, make, model;

-- Create indexes on the materialized view
CREATE INDEX idx_autocomplete_year ON vehicle_autocomplete(year);
CREATE INDEX idx_autocomplete_make ON vehicle_autocomplete(make);
CREATE INDEX idx_autocomplete_display_trgm ON vehicle_autocomplete USING gin(display_text gin_trgm_ops);
CREATE UNIQUE INDEX idx_autocomplete_ymm ON vehicle_autocomplete(year, make, model);

-- =============================================
-- 5. Create helper views for distinct values (faster than SELECT DISTINCT)
-- =============================================
DROP MATERIALIZED VIEW IF EXISTS vehicle_years;
CREATE MATERIALIZED VIEW vehicle_years AS
SELECT DISTINCT year FROM vehicle_specs ORDER BY year DESC;

CREATE UNIQUE INDEX idx_vehicle_years ON vehicle_years(year);

DROP MATERIALIZED VIEW IF EXISTS vehicle_makes;
CREATE MATERIALIZED VIEW vehicle_makes AS
SELECT DISTINCT year, make FROM vehicle_specs ORDER BY year DESC, make;

CREATE INDEX idx_vehicle_makes_year ON vehicle_makes(year);
CREATE UNIQUE INDEX idx_vehicle_makes_ym ON vehicle_makes(year, make);

DROP MATERIALIZED VIEW IF EXISTS vehicle_models;
CREATE MATERIALIZED VIEW vehicle_models AS
SELECT DISTINCT year, make, model FROM vehicle_specs ORDER BY year DESC, make, model;

CREATE INDEX idx_vehicle_models_year_make ON vehicle_models(year, make);
CREATE UNIQUE INDEX idx_vehicle_models_ymm ON vehicle_models(year, make, model);

-- =============================================
-- 6. Create function to refresh materialized views
-- Run this daily via cron or after data imports
-- =============================================
CREATE OR REPLACE FUNCTION refresh_vehicle_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_autocomplete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_years;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_makes;
    REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_models;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 7. Grant permissions
-- =============================================
GRANT SELECT ON vehicle_autocomplete TO anon, authenticated, service_role;
GRANT SELECT ON vehicle_years TO anon, authenticated, service_role;
GRANT SELECT ON vehicle_makes TO anon, authenticated, service_role;
GRANT SELECT ON vehicle_models TO anon, authenticated, service_role;

-- =============================================
-- 8. Add RLS policies for the views (allow public read)
-- =============================================
-- Note: Materialized views don't support RLS directly
-- Access is controlled via the GRANT statements above
