-- =====================================================
-- TRANSPORT LEDGER DATABASE
-- Run in Supabase SQL Editor
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. ADMIN PROFILES
-- Links application roles to Supabase Auth users
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'admin'
        CHECK (role = 'admin'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 2. CUSTOMERS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    billing_address TEXT,
    tax_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 3. INVOICES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_number TEXT NOT NULL UNIQUE,

    customer_id UUID
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,

    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    currency CHAR(3) NOT NULL DEFAULT 'AED',

    total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
        CHECK (total_amount >= 0),

    amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0
        CHECK (amount_paid >= 0),

    status TEXT NOT NULL DEFAULT 'Draft'
        CHECK (
            status IN (
                'Draft',
                'Pending Approval',
                'Approved',
                'Sent',
                'Partially Paid',
                'Paid',
                'Void'
            )
        ),

    notes TEXT,

    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,

    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (period_end >= period_start),

    CHECK (
        amount_paid <= total_amount
        OR status = 'Void'
    )
);

-- =====================================================
-- 4. TRANSPORT SERVICE RECORDS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.transport_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    service_date DATE NOT NULL,

    customer_id UUID
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,

    description TEXT NOT NULL,

    quantity NUMERIC(12, 3) NOT NULL
        CHECK (quantity > 0),

    rate NUMERIC(14, 2) NOT NULL
        CHECK (rate >= 0),

    currency CHAR(3) NOT NULL DEFAULT 'AED',

    remarks TEXT,

    invoice_id UUID
        REFERENCES public.invoices(id)
        ON DELETE SET NULL,

    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 5. PAYMENTS
-- A separate table for individual payment transactions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    invoice_id UUID NOT NULL
        REFERENCES public.invoices(id)
        ON DELETE RESTRICT,

    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,

    amount NUMERIC(14, 2) NOT NULL
        CHECK (amount > 0),

    currency CHAR(3) NOT NULL DEFAULT 'AED',

    payment_method TEXT,
    reference TEXT,
    notes TEXT,

    recorded_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 6. AUDIT HISTORY
-- =====================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id UUID REFERENCES auth.users(id),

    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,

    details JSONB NOT NULL DEFAULT '{}'::JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 7. COMPANY SETTINGS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.company_settings (
    id INTEGER PRIMARY KEY DEFAULT 1
        CHECK (id = 1),

    company_name TEXT NOT NULL DEFAULT 'MSJ Transport L.L.C',
    address TEXT,
    contact_details TEXT,

    default_currency CHAR(3) NOT NULL DEFAULT 'AED',

    logo_url TEXT,

    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.company_settings (id)
VALUES (1)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 8. INDEXES
-- Improve common database lookups
-- =====================================================

CREATE INDEX IF NOT EXISTS transport_date_idx
ON public.transport_records(service_date);

CREATE INDEX IF NOT EXISTS invoice_customer_idx
ON public.invoices(customer_id);

CREATE INDEX IF NOT EXISTS invoice_status_idx
ON public.invoices(status);

CREATE INDEX IF NOT EXISTS payments_invoice_idx
ON public.payments(invoice_id);

CREATE INDEX IF NOT EXISTS audit_date_idx
ON public.audit_logs(created_at DESC);

-- =====================================================
-- 9. ADMIN CHECK FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
    );
$$;

-- =====================================================
-- 10. ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 11. PROFILE POLICIES
-- =====================================================

DROP POLICY IF EXISTS profile_select
ON public.profiles;

CREATE POLICY profile_select
ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR public.is_admin()
);

DROP POLICY IF EXISTS profile_admin_all
ON public.profiles;

CREATE POLICY profile_admin_all
ON public.profiles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- =====================================================
-- 12. ADMIN POLICIES FOR OPERATIONAL TABLES
-- =====================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customers',
        'transport_records',
        'invoices',
        'payments',
        'company_settings'
    ]
    LOOP
        EXECUTE FORMAT(
            'DROP POLICY IF EXISTS admin_all ON public.%I',
            t
        );

        EXECUTE FORMAT(
            'CREATE POLICY admin_all ON public.%I
             FOR ALL TO authenticated
             USING (public.is_admin())
             WITH CHECK (public.is_admin())',
            t
        );
    END LOOP;
END;
$$;

-- =====================================================
-- 13. AUDIT POLICIES
-- =====================================================

DROP POLICY IF EXISTS audit_select
ON public.audit_logs;

CREATE POLICY audit_select
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS audit_insert
ON public.audit_logs;

CREATE POLICY audit_insert
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

-- =====================================================
-- 14. CREATE YOUR FIRST ADMIN PROFILE
--
-- First create the user in Supabase Authentication.
-- Copy that user's UUID, then replace AUTH-USER-UUID
-- with the actual UUID in this example:
--
-- INSERT INTO public.profiles (id, full_name, role)
-- VALUES (
--     'AUTH-USER-UUID',
--     'Administrator',
--     'admin'
-- );
-- =====================================================