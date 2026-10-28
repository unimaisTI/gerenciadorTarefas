import type { ReactNode } from 'react';
import logoBranca from '@/assets/logo-unimais-branca.png';

/** RNF-15.4: gradiente navy da marca com o card translúcido (vidro), só no login. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main
      className="flex min-h-svh items-center justify-center px-4 py-[50px]"
      style={{ background: 'var(--gradient-brand)' }}
    >
      <div
        className="w-full max-w-[420px] rounded-md border border-white/28 p-[30px] text-white shadow-lg"
        style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
      >
        <img src={logoBranca} alt="UNIMAIS" className="mb-[30px] h-11 w-auto" />
        <h1 className="m-0 text-h4 font-bold text-white">{title}</h1>
        {subtitle && <p className="m-0 mt-1.5 text-sm text-white/80">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

export function GlassField({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-white">{label}</span>
      {children}
      {error && (
        <span role="alert" className="text-xs text-red-100">
          {error}
        </span>
      )}
    </label>
  );
}
