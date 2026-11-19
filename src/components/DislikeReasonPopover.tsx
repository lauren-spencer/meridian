import React, { useEffect, useRef } from 'react';
import { DislikeReason } from '../types/job';

const DISLIKE_REASONS: DislikeReason[] = [
  'Wrong employment type',
  'Low pay',
  'Company fit',
  'Wrong role type',
  'Location',
];

interface DislikeReasonPopoverProps {
  onSelect: (reason?: DislikeReason) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}

export function DislikeReasonPopover({
  onSelect,
  onClose,
  align = 'right',
}: DislikeReasonPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Reason for archiving role"
      onClick={(e) => e.stopPropagation()}
      className={`absolute top-full mt-1.5 z-30 w-56 bg-white border border-zinc-200 rounded-lg shadow-lg p-2 ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      <div className="px-2 py-1 text-[11px] font-medium text-zinc-500">
        Why hide this role? (trains agent)
      </div>
      <div className="mt-1 grid grid-cols-1 gap-0.5">
        {DISLIKE_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => onSelect(reason)}
            className="w-full text-left px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 rounded-md transition-colors cursor-pointer"
          >
            {reason}
          </button>
        ))}
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-zinc-100 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelect(undefined)}
          className="text-[11px] text-zinc-500 hover:text-zinc-900 px-1 py-0.5 cursor-pointer"
        >
          Archive without reason
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-zinc-400 hover:text-zinc-700 px-1 py-0.5 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
