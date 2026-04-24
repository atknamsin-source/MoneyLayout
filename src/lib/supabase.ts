/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// URL과 Key가 없으면 기본 더미 클라이언트를 반환하거나 에러를 내지 않도록 처리합니다.
// 환경변수를 설정하지 않고도 앱이 일단 화면은 나오게 하기 위해 옵셔널로 처리합니다.
export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;
