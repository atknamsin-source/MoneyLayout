import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

export default function Main() {
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handleCreate = async (e: React.MouseEvent) => {
    e.preventDefault();
    const cleanId = profileId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    if (!ownerName.trim()) {
      setErrorMsg('이름을 입력해주세요.');
      return;
    }

    if (!cleanId) {
      setErrorMsg('영문 소문자, 숫자, 하이픈(-)만 사용하여 고유 주소를 입력해주세요.');
      return;
    }
    
    setIsLoading(true);
    setErrorMsg('');
    
    if (supabase) {
      try {
        let finalId = cleanId;
        let counter = 1;
        let isUnique = false;
        
        // 중복 체크 로직
        while (!isUnique) {
          const { data: existing, error: fetchError } = await supabase
            .from('baekel_profiles')
            .select('id')
            .eq('id', finalId)
            .maybeSingle(); // single() 사용시 0건일 때 에러 발생하므로 maybeSingle() 사용
            
          if (existing) {
             finalId = `${cleanId}${counter}`;
             counter++;
          } else {
             isUnique = true;
          }
        }
        
        // 고유 ID로 프로필 생성
        const { error } = await supabase
          .from('baekel_profiles')
          .insert({ id: finalId, nickname: '나의 재정상태', owner_name: ownerName.trim() });
          
        if (error) {
          console.error('Error creating profile:', error);
        }
        
        navigate(`/money/${finalId}`);
      } catch (err) {
        console.error('Exception:', err);
        navigate(`/money/${cleanId}`); // 에러 발생 시 일단 입력한 ID로 이동시켜 기능 마비 방지
      } finally {
        setIsLoading(false);
      }
    } else {
      navigate(`/money/${cleanId}`);
    }
  };

  const handleLoad = async (e: React.MouseEvent) => {
    e.preventDefault();
    const cleanId = profileId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!cleanId) {
      setErrorMsg('접속할 프로필 주소를 입력해주세요.');
      return;
    }
    
    if (supabase) {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const { data: existing, error: fetchError } = await supabase
          .from('baekel_profiles')
          .select('id')
          .eq('id', cleanId)
          .maybeSingle();
          
        if (!existing) {
          setShowToast(true);
          setTimeout(() => setShowToast(false), 3000);
          return;
        }
      } catch (err) {
        console.error('Exception loading profile:', err);
      } finally {
        setIsLoading(false);
      }
    }

    navigate(`/money/${cleanId}`);
  };

  return (
    <div className="min-h-screen bg-emerald-50/60 flex flex-col items-center justify-center p-4 font-sans text-slate-900 relative">
      <div className={cn(
        "fixed top-10 left-1/2 -translate-x-1/2 bg-emerald-100 shadow-xl shadow-emerald-200/50 rounded-2xl px-6 py-3 font-bold text-sm text-emerald-900 z-50 flex items-center gap-2 transition-all duration-300 border border-emerald-200",
        showToast ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
      )}>
        <span className="text-lg">💸</span>
        정보가 없습니다.
      </div>
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl shadow-emerald-100/50 p-8 text-center border border-emerald-100">
        <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center text-3xl shadow-inner border border-emerald-200 mx-auto mb-6">
          💸
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          MoneyLayout
        </h1>
        <p className="text-slate-500 mb-8 text-sm">
          MoneyLayout : 내 자산의 밑그림을 그리다.
        </p>
        
        <form className="space-y-4">
          <div className="text-left mb-4">
            <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">사용자 이름</label>
            <div className="flex items-center overflow-hidden border border-slate-300 rounded-xl focus-within:ring-2 focus-within:ring-emerald-200 focus-within:border-emerald-400 bg-slate-50 transition-all">
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="홍길동"
                className="w-full bg-transparent p-3 outline-none text-slate-900 font-bold"
              />
            </div>
          </div>
          
          <div className="text-left">
            <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">나만의 링크 (ID)</label>
            <div className="flex items-center overflow-hidden border border-slate-300 rounded-xl focus-within:ring-2 focus-within:ring-emerald-200 focus-within:border-emerald-400 bg-slate-50 transition-all">
              <span className="pl-4 pr-1 text-slate-400 font-medium text-sm">money/</span>
              <input
                type="text"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                placeholder="my-finance"
                className="flex-1 bg-transparent py-3 pr-4 outline-none text-slate-900 font-bold lowercase"
              />
            </div>
            {errorMsg && (
              <p className="text-rose-500 text-xs mt-2 ml-1">{errorMsg}</p>
            )}
          </div>
          
          <div className="flex flex-col gap-3 mt-6">
            <button
              onClick={handleCreate}
              disabled={isLoading}
              className="w-full bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200 font-bold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] shadow-md shadow-emerald-200/50 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <span>{isLoading ? '생성 중...' : '새 프로필 생성하기'}</span>
            </button>
            <button
              onClick={handleLoad}
              disabled={isLoading}
              className="w-full bg-white hover:bg-slate-50 text-emerald-600 border border-emerald-200 font-bold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] shadow-sm flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <span>기존 프로필 접속하기</span>
            </button>
          </div>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-100 text-[11px] text-slate-400 font-medium">
          * 입력한 주소는 브라우저 주소창에 직접 입력하여 재방문할 수 있습니다.<br/>
          * 타인에게 주소가 노출되지 않도록 고유하고 유추하기 어려운 단어를 포함하는 것을 권장합니다.
        </div>
      </div>
    </div>
  );
}

