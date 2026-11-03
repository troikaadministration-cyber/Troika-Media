import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ToastData {
  id: string;
  type: 'success' | 'error';
  message: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  useEffect(() => {
    // Errors stay longer so there's time to read them.
    const timer = setTimeout(() => onDismiss(toast.id), toast.type === 'error' ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
        toast.type === 'success' ? 'bg-teal' : 'bg-coral'
      }`}
    >
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="text-white/70 hover:text-white" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
