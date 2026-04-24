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
  const { profileId } = useParams<{ profileId: string }>();
  const [nickname, setNickname] = useState('나의 재정상태');
  const [ownerName, setOwnerName] = useState('');
  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [baseAsset, setBaseAsset] = useState<number>(0);
  const [carriedOverAsset, setCarriedOverAsset] = useState<number>(0);
  const [isEarliestMonth, setIsEarliestMonth] = useState<boolean>(true);
  const [items, setItems] = useState<FinancialItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (profileId && supabase) {
      fetchData();
    } else {
      setIsFetching(false);
    }
  }, [profileId, targetMonth]);

  const fetchData = async () => {
    if (!supabase || !profileId) return;
    setIsFetching(true);
    
    try {
      // 1. Get Profile
      const { data: profileData } = await supabase
        .from('baekel_profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      
      if (profileData) {
        setNickname(profileData.nickname || '나의 재정상태');
        setOwnerName(profileData.owner_name || '');
      }

      // 2. Get Monthly Asset
      const { data: assetData, error: assetError } = await supabase
        .from('baekel_monthly_assets')
        .select('*')
        .eq('profile_id', profileId)
        .eq('target_month', targetMonth)
        .maybeSingle();

      if (assetError) {
        if (assetError.code === '42P01') {
           console.error("Missing table baekel_monthly_assets");
        } else if (assetError.code === '42703') {
           console.error("Missing columns");
        }
      }

      if (assetData) {
        setBaseAsset(assetData.base_asset || 0);
      } else {
        setBaseAsset(0);
      }

      // 3. Get Items
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
          ((d.type === 'DEBT' && (d.balance || 0) > 0) || (d.type === 'MINUS' && (d.balance || 0) > 0) || d.is_pinned)
        );
        const currentItemNames = initialItems.map(i => i.name);
        
        const carriedItems = pastItemsToCarry
          .filter(item => !currentItemNames.includes(item.name))
          .map(item => {
            if (item.type === 'DEBT' || item.type === 'MINUS') {
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
          .lt('target_month', targetMonth)
          .gte('target_month', earliestMonth);

        if (pastItems) {
          const pIn = pastItems.filter(i => i.type === 'INCOME').reduce((s, i) => s + (i.monthly_amount || 0), 0);
          const pEx = pastItems.filter(i => i.type === 'EXPENSE').reduce((s, i) => s + (i.monthly_amount || 0), 0);
          const pSav = pastItems.filter(i => i.type === 'SAVING').reduce((s, i) => s + (i.monthly_amount || 0), 0);
          const pDebt = pastItems.filter(i => i.type === 'DEBT').reduce((s, i) => s + (i.monthly_amount || 0), 0);
          pastTotal += (pIn - pEx - pSav - pDebt);
        }
      }

      setCarriedOverAsset(pastTotal);
    } catch (err) {
      console.error(err);
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
    if (!isDirty || isFetching || !targetMonth) return;

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
           owner_name: ownerName
        });

      // 1-1. 특정 월 자산 저장
      const { error: assetError } = await supabase
        .from('baekel_monthly_assets')
        .upsert({
           profile_id: profileId,
           target_month: targetMonth,
           base_asset: Number(baseAsset) || 0
        }, { onConflict: 'profile_id,target_month' });

      if (assetError) {
         console.error("Asset save error: ", assetError);
         if (assetError.code === '42P01') {
            alert('데이터베이스 테이블이 없습니다. supabase_schema.sql을 실행해주세요.');
            setIsSaving(false);
            return;
         }
      }

      // 2. cascade delete deleted items in future months
      const { data: existingItems } = await supabase
         .from('baekel_financial_items')
         .select('id, name')
         .eq('profile_id', profileId)
         .eq('target_month', targetMonth);

      const deletedItemNames = existingItems
         ?.filter(ex => !items.find(it => it.name === ex.name))
         .map(ex => ex.name) || [];

      if (deletedItemNames.length > 0) {
         await supabase
           .from('baekel_financial_items')
           .delete()
           .eq('profile_id', profileId)
           .in('name', deletedItemNames)
           .gt('target_month', targetMonth);
      }

      // 3. 항목 삭제 관리 프로세스: 현재 연결된 모든 항목을 지우고 다시 삽입
      await supabase
        .from('baekel_financial_items')
        .delete()
        .eq('profile_id', profileId)
        .eq('target_month', targetMonth);

      // 4. 사용자가 입력한 현재 항목들을 삽입 (항목이 1개 이상일 경우에만)
      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('baekel_financial_items')
          .insert(items.map(item => ({
             id: item.id,
             profile_id: profileId,
             target_month: targetMonth,
             target_day: item.target_day || null,
             type: item.type,
             name: item.name,
             monthly_amount: Number(item.monthly_amount) || 0,
             balance: Number(item.balance) || 0,
             total_amount: Number(item.total_amount) || 0,
             is_pinned: item.is_pinned || false
          })));
          
        if (itemsError && itemsError.code === '42703') {
           // Fallback: try inserting without the newly added columns (is_pinned, total_amount, target_day) if schema wasn't updated
           console.warn("Retrying without new columns...");
           const { error: fallbackError } = await supabase
             .from('baekel_financial_items')
             .insert(items.map(item => ({
                id: item.id,
                profile_id: profileId,
                target_month: targetMonth,
                type: item.type,
                name: item.name,
                monthly_amount: Number(item.monthly_amount) || 0,
                balance: Number(item.balance) || 0
             })));

           if (fallbackError) {
             alert("데이터 저장에 실패했습니다. (DB 오류)");
             console.error(fallbackError);
           } else {
             alert("✅ 데이터가 임시 저장되었습니다.\n(주의: 고정 항목 기능 등을 사용하려면 DB 스키마 업데이트가 필요합니다.)");

           }
        } else if (itemsError && itemsError.message.includes('type_check')) {
           console.error(itemsError);
        } else if (itemsError) {
           console.error(itemsError);
           if (!isAutoSave) alert("저장 중 오류가 발생했습니다.");
        } else {
           // 정상 저장 성공
           if (!isAutoSave) {
             setShowToast(true);
             setTimeout(() => setShowToast(false), 3000);
           } else {
             setAutoSaveStatus('saved');
             setTimeout(() => setAutoSaveStatus('idle'), 2000);
           }
        }
      } else {
         if (!isAutoSave) {
           setShowToast(true);
           setTimeout(() => setShowToast(false), 3000);
         } else {
           setAutoSaveStatus('saved');
           setTimeout(() => setAutoSaveStatus('idle'), 2000);
         }
      }
      
    } catch (err) {
      console.error('Error saving data:', err);
    } finally {
      if (!isAutoSave) setIsSaving(false);
    }
  };

  const copyToClipboard = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const addItem = (type: ItemType) => {
    const newItem: FinancialItem = {
      id: uuidv4(),
      profile_id: profileId || '',
      target_month: targetMonth,
      target_day: null,
      type,
      name: `새 ${type === 'INCOME' ? '수입' : type === 'EXPENSE' ? '지출' : type === 'DEBT' ? '대출/부채' : type === 'MINUS' ? '마이너스통장' : '저축/투자'}`,
      monthly_amount: 0,
      balance: 0,
      total_amount: 0,
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

  // 핵심 계산 로직 (PRD 명세 반영)
  const calculations = useMemo(() => {
    let totalIncome = 0;
    let totalExpense = 0;
    let totalSaving = 0;
    let totalDebtMonthly = 0;
    let totalMinusUsed = 0;

    items.forEach(item => {
      // 수입, 지출, 저축, 부채 월별 금액 합산
      const amount = Number(item.monthly_amount) || 0;
      if (item.type === 'INCOME') totalIncome += amount;
      if (item.type === 'EXPENSE') totalExpense += amount;
      if (item.type === 'SAVING') totalSaving += amount;
      if (item.type === 'DEBT') totalDebtMonthly += amount;
      if (item.type === 'MINUS') totalMinusUsed += Number(item.balance) || 0;
    });

    // 가용 현금 흐름 = 수입 - 지출 - 저축 - 부채상환
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
    MINUS: items.filter(it => it.type === 'MINUS')
  };

  if (isFetching) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-emerald-50/60 text-slate-900 font-sans p-4 md:p-8 flex flex-col items-center relative">
      {/* Toast Notification */}
      <div className={cn(
        "fixed bottom-10 left-1/2 -translate-x-1/2 bg-emerald-100 shadow-xl shadow-emerald-200/50 rounded-2xl px-6 py-3 font-bold text-sm text-emerald-900 z-50 flex items-center gap-2 transition-all duration-300 border border-emerald-200",
        showToast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      )}>
        <span className="text-lg">💸</span>
        저장되었습니다!
      </div>
      
      <div className="max-w-6xl w-full bg-white rounded-[2rem] shadow-xl shadow-emerald-100/50 p-6 md:p-10 border border-emerald-100 flex-1 flex flex-col my-2">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-xl shadow-inner border border-emerald-200 shrink-0">💸</div>
          <div className="flex flex-col">
            <input 
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setIsDirty(true); }}
              className="text-xl font-bold tracking-tight bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 rounded px-2 -ml-2 transition-all outline-none"
              placeholder="프로필 이름"
            />
            <input 
              value={ownerName}
              onChange={(e) => { setOwnerName(e.target.value); setIsDirty(true); }}
              className="text-sm font-medium text-slate-500 bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 rounded px-2 -ml-2 transition-all outline-none -mt-1"
              placeholder="사용자 이름 (예: 홍길동)"
            />
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
        <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto">
          <div className="flex flex-1 md:flex-none items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="text-slate-400 mr-2 hidden sm:inline">money/</span>
            <span className="font-mono font-medium text-indigo-600 truncate max-w-[120px] sm:max-w-none">{profileId}</span>
            <button 
              onClick={copyToClipboard}
              className="ml-auto md:ml-3 text-slate-400 hover:text-slate-800 transition-colors"
              title="주소 복사"
            >
              {copied ? <span className="text-xs text-emerald-500 font-bold mr-1">복사됨!</span> : <Copy size={16} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {autoSaveStatus !== 'idle' && (
              <span className="text-xs font-bold text-slate-400 mr-2 hidden md:inline">
                {autoSaveStatus === 'saving' ? '자동 저장 중...' : '자동 저장됨'}
              </span>
            )}
            <button 
              onClick={() => handleSave(false)}
              disabled={isSaving}
              className={cn(
                "px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-colors shrink-0 flex items-center gap-2 border border-emerald-200 shadow-emerald-200/50",
                isSaving ? "bg-emerald-50 text-emerald-600/80 cursor-not-allowed" : "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              )}
            >
              {isSaving ? '저장중...' : '저장하기'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-6">
        {/* Dashboard Summary Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          <div className="col-span-1 md:col-span-4 lg:col-span-4 bg-indigo-900 rounded-2xl p-6 flex flex-col justify-between text-white shadow-xl shadow-indigo-100 h-full">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">이달의 가용 현금 흐름</span>
                <span className="bg-white/10 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">MONTHLY</span>
              </div>
              <div className="text-3xl xl:text-4xl font-bold mt-4 tracking-tight block truncate">
                {calculations.availableCashFlow > 0 ? '+' : ''}₩{calculations.availableCashFlow.toLocaleString()}
              </div>
              <p className="text-xs text-indigo-300 mt-3 italic">* 수입 - 지출 - 저축 - 부채 상환금</p>
            </div>
          </div>

          <div className="col-span-1 md:col-span-4 lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm relative overflow-hidden">
            <div>
              {isEarliestMonth ? (
                <>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                    시작 자산 <span className="lowercase text-[10px] font-normal tracking-normal text-slate-400">(첫 달에만 입력)</span>
                  </span>
                  <div className="flex items-center gap-1 border-b-2 border-slate-100 pb-2 mb-3 mt-4 focus-within:border-indigo-300 transition-colors">
                     <span className="text-2xl xl:text-3xl font-black text-slate-900">₩</span>
                     <input 
                        type="text"
                        value={baseAsset === 0 ? '' : baseAsset.toLocaleString()}
                        onChange={(e) => {
                          const val = e.target.value.replace(/,/g, '');
                          if (val === '-' || !isNaN(Number(val))) {
                            setBaseAsset(val === '-' ? '-' as any : Number(val));
                            setIsDirty(true);
                          }
                        }}
                        placeholder="0"
                        className="text-2xl xl:text-3xl font-black tracking-tight text-slate-900 bg-transparent outline-none w-full"
                     />
                  </div>
                  <p className="text-xs text-slate-400 italic">이번 달 처음 시작할 때의 보유 자산</p>
                </>
              ) : (
                <>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 block">이전 이월 자산</span>
                  <div className="flex items-center gap-1 border-b-2 border-slate-100 pb-2 mb-3 mt-4">
                     <span className="text-2xl xl:text-3xl font-black text-slate-400">₩</span>
                     <span className="text-2xl xl:text-3xl font-black tracking-tight text-emerald-600 bg-transparent outline-none w-full">
                       {carriedOverAsset.toLocaleString()}
                     </span>
                  </div>
                  <p className="text-xs text-slate-400 italic">이전 달까지의 누적 자산입니다.</p>
                </>
              )}
            </div>
          </div>

          <div className="col-span-1 md:col-span-4 lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm relative overflow-hidden">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">현재 총 자산</span>
                <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-0.5 rounded-full">TOTAL</span>
              </div>
              <div className="text-3xl xl:text-4xl font-black tracking-tight text-emerald-600 mt-4 block truncate">
                ₩{calculations.totalNetAsset.toLocaleString()}
              </div>
              <p className="text-xs text-slate-400 mt-3 italic">
                * {isEarliestMonth ? '시작 자산 + 가용 현금' : '이전 이월 자산 + 가용 현금'}
              </p>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
                placeholder="-"
                className="w-full text-xs font-bold text-slate-600 outline-none text-right bg-transparent pr-1"
             />
             <span className="text-[10px] font-bold text-slate-400 shrink-0 select-none">일</span>
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
              {type === 'SAVING' && (
                 <div className="flex-1 flex flex-col justify-end pb-1.5">
                    <div className="text-right text-[10px] uppercase font-bold text-slate-400 mb-1">현재 잔액</div>
                    <div className="text-sm font-mono font-bold text-right text-indigo-600">
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
              {type === 'INCOME' ? '수입의 합계' : type === 'EXPENSE' ? '지출의 합계' : type === 'DEBT' ? '부채의 합계' : type === 'MINUS' ? '남은 한도의 합계' : '저축된 금액의 합계'}
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
