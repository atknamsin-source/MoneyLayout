import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { FinancialItem, ItemType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { 
  Building2, 
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy, 
  CreditCard, 
  LineChart, 
  PiggyBank, 
  Plus, 
  Save, 
  Trash2, 
  Wallet,
  Pin
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Dashboard() {
  const { profileId } = useParams();
  
  const [nickname, setNickname] = useState('나의 재정상태');
  const [ownerName, setOwnerName] = useState('');
  const [targetMonth, setTargetMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const [items, setItems] = useState<FinancialItem[]>([]);
  const [baseAsset, setBaseAsset] = useState<number | string>(0);
  const [isEarliestMonth, setIsEarliestMonth] = useState(false);
  const [carriedOverAsset, setCarriedOverAsset] = useState(0); // 전달에서 넘어온 자산
  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isNewProfile, setIsNewProfile] = useState(false);
  const [dbError, setDbError] = useState<string | null>(!supabase ? 'Supabase 환경변수가 누락되었습니다 (.env 확인)' : null);

  // --- Security states ---
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [pinCode, setPinCode] = useState<string>('');
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [inputPin, setInputPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [originalPin, setOriginalPin] = useState<string | null>(null);

  useEffect(() => {
    if (profileId && supabase) {
      if (!showPinModal) {
        fetchData();
      }
    } else {
      setIsFetching(false);
    }
  }, [profileId, targetMonth, isAuthorized]);

  const fetchData = async () => {
    if (!supabase || !profileId) return;

    try {
      setIsFetching(true);
      
      // 1. Fetch Profile
      const { data: profileData, error: profileError } = await supabase
        .from('baekel_profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();

      if (profileData) {
        setIsNewProfile(false);
        setNickname(profileData.nickname || '나의 재정상태');
        setOwnerName(profileData.owner_name || '');
        setPinCode(profileData.pin_code || '');
        setOriginalPin(profileData.pin_code || null);
        
        // Check PIN auth
        if (profileData.pin_code && !isAuthorized) {
          setShowPinModal(true);
          setIsFetching(false);
          return;
        } else {
          setIsAuthorized(true);
        }
      } else {
        setIsNewProfile(true);
        setIsAuthorized(true);
      }

      if (profileError) {
        console.error("Profile fetch error: ", profileError);
      }

      // 2. Fetch or Init Monthly Asset
      const { data: assetData, error: assetError } = await supabase
        .from('baekel_monthly_assets')
        .select('*')
        .eq('profile_id', profileId)
        .eq('target_month', targetMonth)
        .maybeSingle();

      if (assetData) {
        setBaseAsset(assetData.base_asset);
      } else {
        setBaseAsset(0);
      }

      if (assetError) {
        console.error("Asset fetch error: ", assetError);
      }

      // 3. Fetch Items
      const { data: itemsData, error: itemsError } = await supabase
        .from('baekel_financial_items')
        .select('*')
        .eq('profile_id', profileId)
        .eq('target_month', targetMonth);
        
      if (itemsError) {
         console.error("Item fetch error: ", itemsError);
      }

      let initialItems = itemsData || [];

      // Find most recent past items to carry over debts or pinned items
      const { data: pastAllItems } = await supabase
        .from('baekel_financial_items')
        .select('*')
        .eq('profile_id', profileId)
        .lt('target_month', targetMonth)
        .order('target_month', { ascending: false });

      if (pastAllItems && pastAllItems.length > 0) {
        const mostRecentPastMonth = pastAllItems[0].target_month;
        const pastItemsToCarry = pastAllItems.filter(d => 
          d.target_month === mostRecentPastMonth && 
          ((d.type === 'DEBT' && (d.balance || 0) > 0) || (d.type === 'MINUS' && (d.balance || 0) > 0) || (d.type === 'POINT' && (d.balance || 0) > 0) || d.is_pinned)
        );
        const currentItemNames = initialItems.map(i => i.name);
        
        const carriedItems = pastItemsToCarry
          .filter(item => !currentItemNames.includes(item.name))
          .map(item => {
            if (item.type === 'DEBT' || item.type === 'MINUS' || item.type === 'POINT') {
              return {
                ...item,
                id: uuidv4(),
                target_month: targetMonth,
                total_amount: item.type === 'DEBT' ? (item.balance || 0) : (item.total_amount || 0), // previous remaining balance for debt, carry over limit for minus
                monthly_amount: 0, // reset monthly amount
                balance: item.balance || 0
              };
            } else {
              return {
                ...item,
                id: uuidv4(),
                target_month: targetMonth,
                monthly_amount: 0, // reset monthly amount
                balance: 0
              };
            }
          });
          
        initialItems = [...initialItems, ...carriedItems];
      }

      setItems(initialItems);

      // 4. Calculate Carried Over Asset from ALL previous months
      const { data: allPastAssets } = await supabase
        .from('baekel_monthly_assets')
        .select('target_month, base_asset')
        .eq('profile_id', profileId)
        .order('target_month', { ascending: true });

      let earliestMonth = targetMonth;
      let earliestBaseAsset = 0;

      if (allPastAssets && allPastAssets.length > 0) {
        earliestMonth = allPastAssets[0].target_month;
        earliestBaseAsset = allPastAssets[0].base_asset || 0;
      }

      const isEarliest = targetMonth <= earliestMonth;
      setIsEarliestMonth(isEarliest);

      let pastTotal = 0;
      if (!isEarliest) {
        pastTotal += earliestBaseAsset; // ONLY add the earliest base asset to prevent doubling

        const { data: pastItems } = await supabase
          .from('baekel_financial_items')
          .select('type, monthly_amount')
          .eq('profile_id', profileId)
          .lt('target_month', targetMonth);

        if (pastItems) {
          const pastIncome = pastItems.filter(i => i.type === 'INCOME').reduce((s, i) => s + Number(i.monthly_amount || 0), 0);
          const pastExpense = pastItems.filter(i => i.type === 'EXPENSE').reduce((s, i) => s + Number(i.monthly_amount || 0), 0);
          const pastSaving = pastItems.filter(i => i.type === 'SAVING').reduce((s, i) => s + Number(i.monthly_amount || 0), 0);
          const pastDebtRepayment = pastItems.filter(i => i.type === 'DEBT').reduce((s, i) => s + Number(i.monthly_amount || 0), 0);
          
          pastTotal += (pastIncome - pastExpense - pastSaving - pastDebtRepayment);
        }
      }
      setCarriedOverAsset(pastTotal);
      setIsDirty(false);
      setDbError(null);
    } catch (err: any) {
      console.error(err);
      setDbError(err.message || '데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsFetching(false);
    }
  };

  const handlePrevMonth = () => {
    const [year, month] = targetMonth.split('-');
    let d = new Date(Number(year), Number(month) - 1, 1);
    d.setMonth(d.getMonth() - 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setTargetMonth(newMonth);
  };

  const handleNextMonth = () => {
    const [year, month] = targetMonth.split('-');
    let d = new Date(Number(year), Number(month) - 1, 1);
    d.setMonth(d.getMonth() + 1);
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setTargetMonth(newMonth);
  };

  useEffect(() => {
    if (!isDirty || isFetching || !targetMonth || !isAuthorized) return;

    const timer = setTimeout(() => {
      handleSave(true);
    }, 1000); // 1초 입력을 멈추면 자동 저장

    return () => clearTimeout(timer);
  }, [items, baseAsset, nickname, ownerName, isDirty, isFetching, targetMonth]);

  // 데이터 저장 함수 (Supabase 연동)
  const handleSave = async (isAutoSave: boolean = false) => {
    // Supabase 연동이 되어있지 않은 경우 경고 표시 후 로컬에서만 변경 유지
    if (!supabase || !profileId) {
      if (!isAutoSave) alert("Supabase 환경변수가 설정되지 않아 로컬 상태로만 유지됩니다.");
      return;
    }

    if (!targetMonth) {
      if (!isAutoSave) alert("기준 월을 선택해주세요.");
      return;
    }

    setIsDirty(false);
    if (isAutoSave) {
      setAutoSaveStatus('saving');
    } else {
      setIsSaving(true);
    }
    
    try {
      // 1. 프로필 닉네임 저장
      await supabase
        .from('baekel_profiles')
        .upsert({ 
           id: profileId, 
           nickname,
           owner_name: ownerName,
           pin_code: pinCode || null
        });

      // 1-1. 특정 월 자산 저장
      await supabase
        .from('baekel_monthly_assets')
        .upsert(
          {
            profile_id: profileId,
            target_month: targetMonth,
            base_asset: Number(baseAsset) || 0,
          },
          { onConflict: 'profile_id,target_month' }
        );

      // 2. 현재 화면의 아이템 중 profile_id 매핑 누락된 것들 채우기
      const mappedItems = items.map(item => ({
        ...item,
        profile_id: profileId,
        target_month: targetMonth,
      }));

      // 3. 기존 현재 월 데이터 가져오기 (비교 및 삭제용)
      const { data: existingItems } = await supabase
        .from('baekel_financial_items')
        .select('id')
        .eq('profile_id', profileId)
        .eq('target_month', targetMonth);

      const existingIds = existingItems?.map(e => e.id) || [];
      const currentIds = mappedItems.map(m => m.id);
      
      const idsToDelete = existingIds.filter(id => !currentIds.includes(id));

      if (idsToDelete.length > 0) {
        await supabase
          .from('baekel_financial_items')
          .delete()
          .in('id', idsToDelete);
      }

      // Upsert current items
      if (mappedItems.length > 0) {
        const { error: upsertError } = await supabase
          .from('baekel_financial_items')
          .upsert(mappedItems, { onConflict: 'id' });
          
        if (upsertError) throw upsertError;
      }

      if (isAutoSave) {
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      }
      setDbError(null);
    } catch (err: any) {
      console.error(err);
      if (isAutoSave) {
        setAutoSaveStatus('idle'); // revert to idle on error
      }
      if (!isAutoSave) {
        alert('저장 실패: ' + (err.message || '알 수 없는 오류'));
      } else {
        setDbError('자동 저장 실패: ' + (err.message || '알 수 없는 오류'));
      }
    } finally {
      if (!isAutoSave) setIsSaving(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('고유 링크가 복사되었습니다!');
  };

  // --- CRUD Functions (Local state only, syncs on save/auto-save) ---

  const addItem = (type: ItemType) => {
    const newItem: FinancialItem = {
      id: uuidv4(),
      profile_id: profileId || '',
      target_month: targetMonth,
      target_day: null,
      type,
      name: `새 ${type === 'INCOME' ? '수입' : type === 'EXPENSE' ? '지출' : type === 'DEBT' ? '대출/부채' : type === 'MINUS' ? '마이너스통장' : type === 'POINT' ? '포인트/지원금' : '저축/투자'}`,
      monthly_amount: 0,
      balance: 0,
      total_amount: 0,
      is_pinned: false
    };
    setItems(prev => [...prev, newItem]);
    setIsDirty(true);
  };

  const updateItem = (id: string, updates: Partial<FinancialItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
    setIsDirty(true);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    setIsDirty(true);
  };

  // --- Calculations ---

  const calculations = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let totalSaving = 0;
    let totalDebtMonthly = 0;
    let totalMinusUsed = 0;

    items.forEach(item => {
      if (item.type === 'INCOME') totalIncome += Number(item.monthly_amount) || 0;
      if (item.type === 'EXPENSE') totalExpense += Number(item.monthly_amount) || 0;
      if (item.type === 'SAVING') totalSaving += Number(item.monthly_amount) || 0;
      if (item.type === 'DEBT') totalDebtMonthly += Number(item.monthly_amount) || 0;
      if (item.type === 'MINUS') totalMinusUsed += Number(item.balance) || 0;
    });

    // 현금 흐름 = 이번달 수입 - (이번달 지출 + 이번달 저축 + 이번달 대출 상환액)
    const availableCashFlow = totalIncome - totalExpense - totalSaving - totalDebtMonthly;
    
    // 현재 총 순자산 추산: (첫 달이면 시작자산, 아니면 이월자산) + 이번달 잉여 현금 흐름
    const safeBaseAsset = Number(baseAsset) || 0;
    const safeCarriedOver = Number(carriedOverAsset) || 0;
    const totalNetAsset = (isEarliestMonth ? safeBaseAsset : safeCarriedOver) + availableCashFlow;

    return {
      totalIncome,
      totalExpense,
      totalSaving,
      totalDebtMonthly,
      totalMinusUsed,
      totalNetAsset,
      availableCashFlow
    };
  }, [items, baseAsset, carriedOverAsset, isEarliestMonth]);

  const itemGroups = {
    INCOME: items.filter(it => it.type === 'INCOME'),
    EXPENSE: items.filter(it => it.type === 'EXPENSE'),
    SAVING: items.filter(it => it.type === 'SAVING'),
    DEBT: items.filter(it => it.type === 'DEBT'),
    MINUS: items.filter(it => it.type === 'MINUS'),
    POINT: items.filter(it => it.type === 'POINT')
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPin === originalPin) {
      setIsAuthorized(true);
      setShowPinModal(false);
      setPinError('');
    } else {
      setPinError('비밀번호가 일치하지 않습니다.');
    }
  };

  if (showPinModal) {
    return (
      <div className="flex h-screen items-center justify-center bg-emerald-50/60 p-4">
        <form onSubmit={handlePinSubmit} className="bg-white p-8 rounded-3xl shadow-xl border border-emerald-100 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-inner">🔒</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">프라이빗 자산 플래너</h2>
          <p className="text-sm text-slate-500 mb-6">현재 프로필은 비밀번호로 보호되어 있습니다.<br/>확인을 위해 비밀번호를 입력해주세요.</p>
          <input
            type="password"
            value={inputPin}
            onChange={(e) => setInputPin(e.target.value)}
            className="w-full text-center tracking-widest text-lg font-bold px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all mb-2"
            placeholder="비밀번호 4자리"
            maxLength={4}
            autoFocus
          />
          {pinError && <p className="text-rose-500 text-sm font-medium mb-4">{pinError}</p>}
          <button 
            type="submit" 
            className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors shadow-md shadow-emerald-500/30"
          >
            확인
          </button>
        </form>
      </div>
    );
  }

  if (isFetching) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="animate-spin text-slate-300 mb-4"><PiggyBank size={40} /></div>
          <p className="text-slate-500 font-medium">데이터를 불러오는 중입니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans selection:bg-indigo-100 selection:text-indigo-900 overflow-x-hidden">
      {/* Network Error Toast */}
      {dbError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-rose-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg z-50 animate-bounce">
          {dbError}
        </div>
      )}

      {/* Auto-save Toast */}
      {autoSaveStatus === 'saved' && (
        <div className="fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg z-50 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
          안전하게 자동 저장되었습니다
        </div>
      )}

      {/* Navigation & Toolbar */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm px-4 md:px-8 py-3.5 flex justify-between items-center transition-all">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-inner shadow-indigo-300 text-white shadow-sm">
            <PiggyBank size={20} className="drop-shadow-sm" />
          </div>
          <div className="flex flex-col max-w-[200px] md:max-w-xs">
            <input 
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setIsDirty(true); }}
              className="text-xl font-bold tracking-tight bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 rounded px-2 -ml-2 transition-all outline-none"
              placeholder="프로필 이름"
            />
            <div className="flex items-center gap-2 -mt-1">
              <input 
                value={ownerName}
                onChange={(e) => { setOwnerName(e.target.value); setIsDirty(true); }}
                className="text-sm font-medium text-slate-500 bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 rounded px-2 -ml-2 transition-all outline-none"
                placeholder="사용자 이름"
              />
              <div className="flex items-center bg-slate-100 rounded px-2 border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all">
                <span className="text-xs text-slate-400 mr-1">🔒</span>
                <input
                  type="password"
                  value={pinCode}
                  onChange={(e) => { setPinCode(e.target.value); setIsDirty(true); }}
                  className="w-16 bg-transparent text-sm font-medium text-slate-500 outline-none"
                  placeholder="PIN"
                  maxLength={4}
                  title="4자리 PIN 번호를 설정하여 타인의 접근을 막으세요"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm ml-auto md:ml-2">
            <button 
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-colors active:bg-slate-100"
              title="이전 달"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="text-sm font-bold text-slate-600 bg-white hover:bg-slate-50 border-x border-slate-100 px-3 h-[34px] outline-none transition-colors"
              title="월 선택"
            />
            <button 
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-colors active:bg-slate-100"
              title="다음 달"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="flex gap-2.5 shrink-0 opacity-0 md:opacity-100">
          <button 
            onClick={copyLink} 
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all shadow-sm"
          >
            <Copy size={16} /> 링크
          </button>
          <button 
            onClick={() => handleSave(false)} 
            disabled={isSaving || !isDirty}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold rounded-lg transition-all shadow-sm",
              isSaving 
                ? "bg-indigo-400 text-indigo-50 cursor-not-allowed" 
                : !isDirty 
                  ? "bg-slate-100 text-slate-400 cursor-default shadow-none border border-slate-200" 
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20"
            )}
          >
            {isSaving ? <span className="animate-spin"><PiggyBank size={16}/></span> : <Save size={16} />} 
            {isSaving ? '저장중...' : !isDirty ? '저장됨' : '저장'}
          </button>
        </div>
      </nav>

      {/* Floating Save Button on Mobile */}
      <div className="md:hidden fixed bottom-6 right-6 z-40 flex flex-col gap-2">
         <button 
            onClick={copyLink} 
            className="w-12 h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-600 rounded-full hover:bg-slate-50 transition-all shadow-md"
          >
            <Copy size={20} />
          </button>
         <button 
            onClick={() => handleSave(false)} 
            disabled={isSaving || !isDirty}
            className={cn(
              "w-12 h-12 flex items-center justify-center text-white rounded-full transition-all shadow-lg",
              isSaving 
                ? "bg-indigo-400 cursor-not-allowed" 
                : !isDirty 
                  ? "bg-slate-400 cursor-default shadow-none" 
                  : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30"
            )}
          >
            {isSaving ? <span className="animate-spin"><PiggyBank size={20}/></span> : <Save size={20} />} 
          </button>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
      {/* Main Asset Header */}
      <header className="mb-8 md:mb-10 bg-white rounded-3xl p-6 md:p-10 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-end justify-between gap-8 relative overflow-hidden group">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50 group-hover:bg-indigo-100 transition-colors pointer-events-none"></div>
        <div className="relative z-10 w-full md:w-auto">
          <h2 className="text-sm font-bold tracking-widest text-slate-400 uppercase mb-3 flex items-center gap-2">
            <Wallet size={16} /> 
            나의 순자산 
            {isEarliestMonth && <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-sm ml-1 select-none font-bold">초기 자산 설정가능</span>}
          </h2>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight">₩</span>
            {isEarliestMonth ? (
                <input 
                  type="text" 
                  value={baseAsset === 0 ? '' : Number(baseAsset).toLocaleString()}
                  onChange={(e) => {
                    const val = e.target.value.replace(/,/g, '');
                    if (val === '') { setBaseAsset(0); setIsDirty(true); }
                    else if (!isNaN(Number(val))) { setBaseAsset(Number(val)); setIsDirty(true); }
                  }}
                  className="text-4xl md:text-6xl font-black text-slate-900 bg-transparent border-b-2 border-indigo-200 focus:border-indigo-600 outline-none w-48 md:w-64 transition-colors"
                  placeholder="0"
                />
            ) : (
                <span className="text-4xl md:text-6xl font-black text-slate-900 select-all">
                  {calculations.totalNetAsset.toLocaleString()}
                </span>
            )}
          </div>
          {!isEarliestMonth && (
            <div className="text-sm font-bold text-slate-400 mt-3 pl-1 hidden md:block">
              기존 자산 + 이번 달 잉여 현금 {calculations.availableCashFlow > 0 ? `(+₩${calculations.availableCashFlow.toLocaleString()})` : `(₩${calculations.availableCashFlow.toLocaleString()})`}
            </div>
          )}
        </div>
        
        <div className="relative z-10 flex gap-4 md:gap-6 border-t md:border-t-0 border-slate-100 pt-6 md:pt-0">
          <div>
            <p className="text-xs font-bold uppercase text-slate-400 mb-1 flex items-center gap-1.5"><CreditCard size={14} />이번 달 잉여자금</p>
            <p className={cn("text-2xl font-black", calculations.availableCashFlow >= 0 ? "text-emerald-500" : "text-rose-500")}>
              {calculations.availableCashFlow >= 0 ? '+' : ''}{calculations.availableCashFlow.toLocaleString()}
            </p>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      <main>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 auto-rows-max items-start">
          <Section 
            title="수입" 
            type="INCOME"
            items={itemGroups.INCOME} 
            onAdd={() => addItem('INCOME')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-emerald-500"
            footerBg="bg-emerald-50"
            footerText="text-emerald-700"
            totalAmount={calculations.totalIncome}
          />
          <Section 
            title="지출" 
            type="EXPENSE"
            items={itemGroups.EXPENSE} 
            onAdd={() => addItem('EXPENSE')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-rose-500"
            footerBg="bg-rose-50"
            footerText="text-rose-700"
            totalAmount={calculations.totalExpense}
          />
          <Section 
            title="저축 및 투자" 
            type="SAVING"
            items={itemGroups.SAVING} 
            onAdd={() => addItem('SAVING')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-indigo-500"
            footerBg="bg-indigo-50"
            footerText="text-indigo-700"
            totalAmount={itemGroups.SAVING.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)}
          />
          <Section 
            title="대출 및 부채" 
            type="DEBT"
            items={itemGroups.DEBT} 
            onAdd={() => addItem('DEBT')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-amber-500"
            footerBg="bg-amber-50"
            footerText="text-amber-700"
            totalAmount={itemGroups.DEBT.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)}
          />
          <Section 
            title="마이너스 통장" 
            type="MINUS"
            items={itemGroups.MINUS} 
            onAdd={() => addItem('MINUS')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-slate-500"
            footerBg="bg-slate-50"
            footerText="text-slate-700"
            totalAmount={itemGroups.MINUS.reduce((sum, item) => sum + ((Number(item.total_amount) || 0) - (Number(item.balance) || 0)), 0)}
          />
          <Section 
            title="포인트 및 지원금" 
            type="POINT"
            items={itemGroups.POINT} 
            onAdd={() => addItem('POINT')}
            onUpdate={updateItem}
            onRemove={removeItem}
            accentColor="bg-fuchsia-500"
            footerBg="bg-fuchsia-50"
            footerText="text-fuchsia-700"
            totalAmount={itemGroups.POINT.reduce((sum, item) => sum + (Number(item.balance) || 0), 0)}
          />
        </div>
      </main>
      
      {/* Footer System Note */}
      <footer className="mt-12 flex justify-center items-center text-xs text-slate-400 font-medium pb-2 text-center w-full">
        <div>누구나 부자가 될 수 있다.</div>
      </footer>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  type: ItemType;
  items: FinancialItem[];
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<FinancialItem>) => void;
  onRemove: (id: string) => void;
  accentColor: string;
  footerBg: string;
  footerText: string;
  totalAmount: number;
}

interface ItemRowProps {
  key?: string | number;
  item: FinancialItem;
  type: ItemType;
  onUpdate: (id: string, updates: Partial<FinancialItem>) => void;
  onRemove: (id: string) => void;
}

function ItemRow({ item, type, onUpdate, onRemove }: ItemRowProps) {
  // Always expand by default as requested by the user
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="relative flex flex-col pt-3 pb-2 px-3 bg-slate-50 rounded-xl border border-slate-100 group/item hover:border-indigo-200 transition-colors">
      <div className="flex gap-2 items-center mb-1">
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors shrink-0"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="w-14 shrink-0">
           <div className="flex items-center bg-white border border-slate-200 rounded-lg px-1.5 py-1 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400 transition-shadow">
             <input
                type="number"
                min="1"
                max="31"
                value={item.target_day || ''}
                onChange={(e) => onUpdate(item.id, { target_day: e.target.value ? Number(e.target.value) : null })}
                placeholder="일"
                className="w-full bg-transparent text-center text-xs font-mono font-bold text-slate-600 outline-none appearance-none m-0"
             />
             <span className="text-[10px] text-slate-400 font-medium pointer-events-none select-none">일</span>
           </div>
        </div>
        <input 
          type="text" 
          value={item.name}
          onChange={(e) => onUpdate(item.id, { name: e.target.value })}
          placeholder="항목명 (예: 급여, 적금)"
          className="flex-1 bg-transparent border-none appearance-none text-sm font-medium text-slate-800 focus:outline-none focus:ring-0 px-0"
        />
        {!isExpanded && (
          <div className="text-xs font-mono font-bold text-slate-600 text-right shrink-0">
            {type === 'MINUS' ? `-₩${(item.balance || 0).toLocaleString()}` : type === 'DEBT' ? `₩${(item.monthly_amount || 0).toLocaleString()}` : `₩${(item.monthly_amount || 0).toLocaleString()}`}
          </div>
        )}
        <div className={cn("flex items-center transition-opacity", !isExpanded ? "opacity-0 group-hover/item:opacity-100" : "opacity-100")}>
          <button 
            onClick={() => onUpdate(item.id, { is_pinned: !item.is_pinned })}
            className={cn("p-1 ml-1 transition-colors", item.is_pinned ? "text-indigo-500 hover:text-indigo-600" : "text-slate-300 hover:text-indigo-500")}
            title={item.is_pinned ? "다음 달에도 항목 유지 해제" : "다음 달에도 항목 유지"}
          >
            <Pin size={14} className={cn(item.is_pinned && "fill-indigo-500")} />
          </button>
          <button 
            onClick={() => onRemove(item.id)}
            className="text-slate-300 hover:text-rose-500 p-1 ml-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className={cn("grid transition-all duration-300 ease-in-out", isExpanded ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 mt-0")}>
        <div className="overflow-hidden">
          {type === 'MINUS' ? (
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col">
                 <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">개설 한도</label>
                 <input 
                    type="text" 
                    value={item.total_amount === 0 ? '' : item.total_amount?.toLocaleString() || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      if (val === '-' || !isNaN(Number(val))) {
                        onUpdate(item.id, { total_amount: val === '-' ? '-' as any : Number(val) });
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-slate-700 outline-none focus:border-indigo-400 transition-shadow"
                  />
              </div>
              <div className="flex-1 flex flex-col">
                 <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">사용 금액</label>
                 <div className="relative">
                   <span className="absolute left-2 top-1.5 text-xs font-mono font-bold text-rose-500">-</span>
                   <input 
                      type="text" 
                      value={item.balance === 0 ? '' : item.balance.toLocaleString()}
                      onChange={(e) => {
                        const val = e.target.value.replace(/,/g, '');
                        if (val === '-' || !isNaN(Number(val))) {
                          onUpdate(item.id, { balance: val === '-' ? '-' as any : Number(val) });
                        }
                      }}
                      placeholder="0"
                      className="w-full bg-white border border-slate-200 rounded-lg pl-5 pr-2 py-1.5 text-xs font-mono font-bold text-rose-600 outline-none focus:border-rose-400 transition-shadow text-left"
                    />
                 </div>
              </div>
              <div className="flex-1 flex flex-col justify-end pb-1.5">
                 <div className="text-right text-[10px] uppercase font-bold text-slate-400 mb-1">남은 한도</div>
                 <div className="text-xs font-mono font-bold text-right text-slate-500 mt-1.5">
                    {item.total_amount ? (Number(item.total_amount || 0) - Number(item.balance || 0)).toLocaleString() : 0} 원
                 </div>
              </div>
            </div>
          ) : type === 'DEBT' ? (
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col">
                 <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">대출 원금</label>
                 <input 
                    type="text" 
                    value={item.total_amount === 0 ? '' : item.total_amount?.toLocaleString() || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      if (val === '-' || !isNaN(Number(val))) {
                        const newTotal = val === '-' ? '-' as any : Number(val);
                        onUpdate(item.id, { 
                          total_amount: newTotal,
                          balance: newTotal === '-' ? 0 : newTotal - (Number(item.monthly_amount) || 0)
                        });
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-slate-700 outline-none focus:border-indigo-400 transition-shadow"
                  />
              </div>
              <div className="flex-1 flex flex-col">
                 <div className="flex items-center justify-between mb-1">
                   <label className="text-[10px] uppercase font-bold text-slate-400">상환액 (월)</label>
                 </div>
                 <input 
                    type="text" 
                    value={item.monthly_amount === 0 ? '' : item.monthly_amount.toLocaleString()}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      if (val === '-' || !isNaN(Number(val))) {
                        const newMonthly = val === '-' ? '-' as any : Number(val);
                        onUpdate(item.id, { 
                          monthly_amount: newMonthly,
                          balance: (Number(item.total_amount) || 0) - (newMonthly === '-' ? 0 : newMonthly)
                        });
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-slate-700 outline-none focus:border-indigo-400 transition-shadow text-left"
                  />
              </div>
              <div className="flex-1 flex flex-col justify-end pb-1.5">
                 <div className="text-right text-[10px] uppercase font-bold text-slate-400 mb-1">남은 원금</div>
                 <div className="text-xs font-mono font-bold text-right text-amber-600 mt-1.5">
                    {item.balance.toLocaleString()} 원
                 </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1 flex flex-col">
                 <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">월 금액</label>
                 <input 
                    type="text" 
                    value={item.monthly_amount === 0 ? '' : item.monthly_amount.toLocaleString()}
                    onChange={(e) => {
                      const val = e.target.value.replace(/,/g, '');
                      if (val === '-' || !isNaN(Number(val))) {
                        onUpdate(item.id, { monthly_amount: val === '-' ? '-' as any : Number(val) });
                      }
                    }}
                    placeholder="0"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono font-bold text-slate-700 outline-none focus:border-indigo-400 transition-shadow text-left"
                  />
              </div>
              {(type === 'SAVING' || type === 'POINT') && (
                 <div className="flex-1 flex flex-col justify-end pb-1.5">
                    <div className="text-right text-[10px] uppercase font-bold text-slate-400 mb-1">{type === 'POINT' ? '누적 총액' : '현재 잔액'}</div>
                    <div className={cn("text-sm font-mono font-bold text-right", type === 'POINT' ? "text-fuchsia-600" : "text-indigo-600")}>
                       <input 
                           type="text" 
                           value={item.balance === 0 ? '' : item.balance.toLocaleString()}
                           onChange={(e) => {
                              const val = e.target.value.replace(/,/g, '');
                              if (val === '-' || !isNaN(Number(val))) {
                                onUpdate(item.id, { balance: val === '-' ? '-' as any : Number(val) });
                              }
                           }}
                           placeholder="0"
                           className="w-full bg-transparent text-right font-mono font-bold outline-none border-b border-transparent focus:border-indigo-300 transition-colors"
                         />
                    </div>
                 </div>
              )}
            </div>
          )}

          {Math.random() < 2 /* dummy to bypass condition */ && type === 'SAVING' && (
            <div className="text-right text-[11px] text-indigo-600 font-bold pt-1.5 border-t border-indigo-100 mt-2">
               💡 1년 뒤 달성 예상금액: {((item.balance || 0) + (item.monthly_amount || 0) * 12).toLocaleString()} 원
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, type, items, onAdd, onUpdate, onRemove, accentColor, footerBg, footerText, totalAmount }: SectionProps) {
  const [isSectionExpanded, setIsSectionExpanded] = useState(false);

  return (
    <div className={cn("bg-white rounded-2xl border border-slate-200 flex flex-col shadow-sm transition-all duration-300 overflow-hidden", isSectionExpanded ? "h-[540px]" : "h-[74px]")}>
      <div 
        className={cn("p-4 flex justify-between items-center cursor-pointer select-none", isSectionExpanded ? "border-b border-slate-100 rounded-t-2xl" : "rounded-2xl")}
        onClick={() => setIsSectionExpanded(!isSectionExpanded)}
      >
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <button className="text-slate-400 hover:text-slate-600 focus:outline-none shrink-0 transition-transform duration-300" style={{ transform: isSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
             <ChevronDown size={20} />
          </button>
          <span className={cn("w-2 h-4 rounded-sm", accentColor)}></span>
          {title}
        </h3>
        <div className="flex items-center gap-4">
          {!isSectionExpanded && (
            <span className="font-mono font-bold text-slate-700 text-sm">
              ₩{totalAmount.toLocaleString()}
            </span>
          )}
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
              if (!isSectionExpanded) setIsSectionExpanded(true);
            }} 
            className={cn("text-xs font-bold hover:underline", footerText)}
          >
            + 항목 추가
          </button>
        </div>
      </div>
      
      {isSectionExpanded && (
        <>
          <div className="p-4 flex-1 space-y-3 overflow-y-auto min-h-0 bg-white">
            {items.length === 0 ? (
              <div className="text-center py-10">
                 <p className="text-sm text-slate-400 mb-2">등록된 항목이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <ItemRow 
                    key={item.id} 
                    item={item} 
                    type={type} 
                    onUpdate={onUpdate} 
                    onRemove={onRemove} 
                  />
                ))}
              </div>
            )}
          </div>

          <div className={cn("p-4 flex justify-between items-center rounded-b-2xl", footerBg)}>
            <span className={cn("text-xs font-bold uppercase", footerText)}>
              {type === 'INCOME' ? '수입의 합계' : type === 'EXPENSE' ? '지출의 합계' : type === 'DEBT' ? '부채의 합계' : type === 'MINUS' ? '남은 한도의 합계' : type === 'POINT' ? '누적 총액의 합계' : '저축된 금액의 합계'}
            </span>
            <div className="flex flex-col items-end">
              <span className={cn("text-lg font-black", footerText)}>
                {type === 'MINUS' ? `₩${totalAmount.toLocaleString()}` : `₩${totalAmount.toLocaleString()}`}
              </span>
              {type === 'DEBT' && items.length > 0 && (
                <span className="text-[10px] font-bold text-amber-900/60 mt-1">이번 달 상환액: ₩{items.reduce((s, i) => s + (Number(i.monthly_amount) || 0), 0).toLocaleString()}</span>
              )}
              {type === 'SAVING' && items.length > 0 && (
                <span className="text-[10px] font-bold text-indigo-900/60 mt-1">이번 달 저축액: ₩{items.reduce((s, i) => s + (Number(i.monthly_amount) || 0), 0).toLocaleString()}</span>
              )}
              {type === 'POINT' && items.length > 0 && (
                <span className="text-[10px] font-bold text-fuchsia-900/60 mt-1">이번 달 적립/사용액 (합계): ₩{items.reduce((s, i) => s + (Number(i.monthly_amount) || 0), 0).toLocaleString()}</span>
              )}
              {type === 'MINUS' && items.length > 0 && (
                <span className="text-[10px] font-bold text-slate-500/80 mt-1">총 사용 금액: ₩{items.reduce((s, i) => s + (Number(i.balance) || 0), 0).toLocaleString()}</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}