-- =============================================
-- ORGANIZATION EMAIL DOMAINS
-- Allow any organization to claim email domains
-- Users signing up with matching domains are auto-added
-- =============================================

-- 1. Create organization_email_domains table
CREATE TABLE IF NOT EXISTS organization_email_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(64),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(domain) -- Each domain can only belong to one org
);

CREATE INDEX IF NOT EXISTS idx_org_domains_org ON organization_email_domains(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_domains_domain ON organization_email_domains(domain);
CREATE INDEX IF NOT EXISTS idx_org_domains_verified ON organization_email_domains(is_verified) WHERE is_verified = true;

-- 2. Enable RLS
ALTER TABLE organization_email_domains ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies

-- Org owners/admins can read their org's domains
CREATE POLICY "Org admins can read domains"
    ON organization_email_domains FOR SELECT
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'support')
    );

-- Org owners/admins can add domains
CREATE POLICY "Org admins can add domains"
    ON organization_email_domains FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

-- Org owners/admins can update domains
CREATE POLICY "Org admins can update domains"
    ON organization_email_domains FOR UPDATE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

-- Org owners/admins can delete domains
CREATE POLICY "Org admins can delete domains"
    ON organization_email_domains FOR DELETE
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_user_id = auth.uid()
            UNION
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
        OR is_admin(auth.uid(), 'admin')
    );

-- 4. Function to check if a domain belongs to an organization
CREATE OR REPLACE FUNCTION get_org_for_email_domain(p_email TEXT)
RETURNS UUID AS $$
DECLARE
    email_domain TEXT;
    v_org_id UUID;
BEGIN
    email_domain := lower(split_part(p_email, '@', 2));

    SELECT organization_id INTO v_org_id
    FROM organization_email_domains
    WHERE lower(domain) = email_domain
    AND is_verified = TRUE;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function to auto-add user to org on signup based on email domain
CREATE OR REPLACE FUNCTION auto_join_org_by_email_domain()
RETURNS TRIGGER AS $$
DECLARE
    email_domain TEXT;
    v_domain_record RECORD;
BEGIN
    -- Get email domain from new user
    IF NEW.email IS NOT NULL THEN
        email_domain := lower(split_part(NEW.email, '@', 2));

        -- Check if domain belongs to an org
        SELECT * INTO v_domain_record
        FROM organization_email_domains
        WHERE lower(domain) = email_domain AND is_verified = TRUE;

        IF FOUND THEN
            -- Check if user is already a member
            IF NOT EXISTS (
                SELECT 1 FROM organization_members
                WHERE organization_id = v_domain_record.organization_id
                AND user_id = NEW.id
            ) THEN
                -- Check if user is the owner (don't add as member if owner)
                IF NOT EXISTS (
                    SELECT 1 FROM organizations
                    WHERE id = v_domain_record.organization_id
                    AND owner_user_id = NEW.id
                ) THEN
                    -- Add user as member to the organization
                    INSERT INTO organization_members (organization_id, user_id, role)
                    VALUES (v_domain_record.organization_id, NEW.id, 'member');
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create trigger on auth.users for auto-joining orgs
DROP TRIGGER IF EXISTS on_user_auto_join_org ON auth.users;
CREATE TRIGGER on_user_auto_join_org
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION auto_join_org_by_email_domain();

-- 7. Grant permissions
GRANT ALL ON organization_email_domains TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
