import logoBranca from '@/assets/logo-unimais-branca.png';

export interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = 'Carregando...' }: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-5 p-[50px] text-white"
      style={{ background: 'var(--gradient-brand)' }}
    >
      <img src={logoBranca} alt="UNIMAIS" className="h-14 w-auto" />
      <div className="h-1 w-[220px] overflow-hidden rounded-pill bg-white/20">
        <div className="loading-bar h-full w-2/5 rounded-pill bg-red-500" />
      </div>
      <span className="text-sm text-white/72">{label}</span>
      <style>{`
        @keyframes unimais-indeterminate { 0% { transform: translateX(-100%) } 100% { transform: translateX(250%) } }
        .loading-bar { animation: unimais-indeterminate 1.4s var(--ease-in-out) infinite }
        @media (prefers-reduced-motion: reduce) { .loading-bar { animation: none } }
      `}</style>
    </div>
  );
}
