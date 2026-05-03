import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MansionCard = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn(
    "bg-[#151619]/90 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl",
    className
  )}>
    {children}
  </div>
);

export const MansionButton = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: 'primary' | 'secondary' | 'danger',
  className?: string,
  disabled?: boolean
}) => {
  const variants = {
    primary: "bg-white text-black hover:bg-white/90",
    secondary: "bg-transparent border border-white/20 text-white hover:bg-white/5",
    danger: "bg-red-600 text-white hover:bg-red-700"
  };

  return (
    <button 
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "px-6 py-3 rounded-full transition-all active:scale-95 text-sm uppercase tracking-widest font-medium disabled:opacity-50 disabled:scale-100",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
};

export const MansionInput = ({ 
  value, 
  onChange, 
  placeholder, 
  className 
}: { 
  value: string, 
  onChange: (val: string) => void, 
  placeholder?: string,
  className?: string
}) => (
  <input 
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={cn(
      "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-all",
      className
    )}
  />
);

export const MansionLabel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <span className={cn(
    "text-[10px] uppercase tracking-[0.2em] font-semibold text-white/50 block mb-2",
    className
  )}>
    {children}
  </span>
);

export const MansionBadge = ({ children, color = 'white', className }: { children: React.ReactNode, color?: string, className?: string }) => (
  <span className={cn(
    "px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border",
    color === 'white' ? "bg-white/10 border-white/20 text-white" : "bg-red-500/20 border-red-500/30 text-red-400",
    className
  )}>
    {children}
  </span>
);
