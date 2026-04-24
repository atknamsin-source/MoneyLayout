export type ItemType = 'INCOME' | 'EXPENSE' | 'SAVING' | 'DEBT' | 'MINUS';

export interface Profile {
  id: string; // text (URL profile id)
  nickname: string;
  owner_name?: string;
  created_at?: string;
}

export interface FinancialItem {
  id: string; // db uuid
  profile_id: string; // text (url id)
  target_month: string; // YYYY-MM
  target_day?: number | null; // 1-31 (일자)
  type: ItemType;
  name: string;
  monthly_amount: number;
  balance: number; // 현재 잔액/부채액
  total_amount?: number; // 부채 총 원금
  is_pinned?: boolean; // 다음 달로 항목 틀 고정 여부
  created_at?: string;
}

