import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { formatFullMobileNumber, copyTextToClipboard } from '../utils/customerFormat';

interface CopyMobileButtonProps {
  countryCode?: string | null;
  mobileNumber?: string | null;
  onCopied?: (message: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export const CopyMobileButton: React.FC<CopyMobileButtonProps> = ({
  countryCode = '+91',
  mobileNumber,
  onCopied,
  className = '',
  size = 'sm',
}) => {
  const [copied, setCopied] = useState(false);

  const fullNumber = formatFullMobileNumber(countryCode, mobileNumber);
  if (!mobileNumber || !fullNumber) return null;

  const handleCopyClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Strictly prevent triggering parent row clicks, modals, or WhatsApp share actions
    e.stopPropagation();
    e.preventDefault();

    const success = await copyTextToClipboard(fullNumber);
    if (success) {
      setCopied(true);
      const confirmationMsg = 'Mobile number copied successfully!';
      if (onCopied) {
        onCopied(confirmationMsg);
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('annpurna:toast', { detail: { message: confirmationMsg } })
        );
      }
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  const sizeClasses =
    size === 'md'
      ? 'px-2.5 py-1.5 text-xs gap-1.5 min-h-[34px]'
      : 'px-2 py-1 text-[11px] gap-1 min-h-[28px] min-w-[28px]';

  return (
    <button
      type="button"
      onClick={handleCopyClick}
      title={`Copy ${fullNumber}`}
      aria-label={`Copy mobile number ${fullNumber}`}
      className={`inline-flex items-center justify-center rounded-lg border font-sans font-semibold transition select-none cursor-pointer touch-manipulation ${sizeClasses} ${
        copied
          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
          : 'bg-slate-100 hover:bg-blue-50 active:bg-blue-100 border-slate-200 hover:border-blue-300 text-slate-600 hover:text-blue-700'
      } ${className}`}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 shrink-0" />
          <span className="sr-only sm:not-sr-only">Copy</span>
        </>
      )}
    </button>
  );
};
