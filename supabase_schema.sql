-- Supabase SQL Schema for Moneyset (BaekEl Finance)
-- 기존 데이터를 보존하기 위해 DROP 구문을 제거하고 안전하게 구조를 업데이트합니다.

-- 1. Profiles Table 생성 (이미 존재하면 건너뜀)
CREATE TABLE IF NOT EXISTS public.baekel_profiles (
  id text PRIMARY KEY,
  nickname text NOT NULL DEFAULT '나의 재정상태',
  owner_name text DEFAULT '',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 기존 테이블에 owner_name 컬럼만 추가하는 구문 (안전하게 컬럼 추가)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='baekel_profiles' AND column_name='owner_name') THEN 
    ALTER TABLE public.baekel_profiles ADD COLUMN owner_name text DEFAULT ''; 
  END IF; 
END $$;

-- 2. Monthly Assets Table (월별 기준 자산) 생성 (이미 존재하면 건너뜀)
CREATE TABLE IF NOT EXISTS public.baekel_monthly_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text REFERENCES public.baekel_profiles(id) ON DELETE CASCADE,
  target_month text NOT NULL,
  base_asset numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(profile_id, target_month)
);

-- 3. Financial Items Table (월별) 생성 (이미 존재하면 건너뜀)
CREATE TABLE IF NOT EXISTS public.baekel_financial_items (
  id uuid PRIMARY KEY,
  profile_id text REFERENCES public.baekel_profiles(id) ON DELETE CASCADE,
  target_month text NOT NULL,
  target_day integer DEFAULT NULL,
  type text NOT NULL CHECK (type IN ('INCOME', 'EXPENSE', 'SAVING', 'DEBT', 'MINUS')),
  name text NOT NULL,
  monthly_amount numeric DEFAULT 0,
  balance numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  is_pinned boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Enable RLS (Row Level Security)
ALTER TABLE public.baekel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baekel_monthly_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baekel_financial_items ENABLE ROW LEVEL SECURITY;

-- 6. Create policies for anon access (로그인 없이 누구나 읽고 쓸 수 있도록 정책 오픈)
DROP POLICY IF EXISTS "Enable all for anon on baekel_profiles" ON public.baekel_profiles;
CREATE POLICY "Enable all for anon on baekel_profiles" 
  ON public.baekel_profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for anon on baekel_monthly_assets" ON public.baekel_monthly_assets;
CREATE POLICY "Enable all for anon on baekel_monthly_assets" 
  ON public.baekel_monthly_assets FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for anon on baekel_financial_items" ON public.baekel_financial_items;
CREATE POLICY "Enable all for anon on baekel_financial_items" 
  ON public.baekel_financial_items FOR ALL USING (true) WITH CHECK (true);

