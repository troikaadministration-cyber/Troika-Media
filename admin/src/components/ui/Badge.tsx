import React from 'react';

const VARIANTS: Record<string, string> = {
  pending: 'bg-coral text-white',
  completed: 'bg-teal text-white',
  scheduled: 'bg-coral text-white',
  cancelled: 'bg-gray-400 text-white',
  regular: 'bg-navy text-white',
  makeup: 'bg-amber-500 text-white',
  special: 'bg-purple-500 text-white',
  charged: 'bg-red-100 text-red-700',
  not_charged: 'bg-green-100 text-green-700',
  active: 'bg-teal-light text-teal',
  inactive: 'bg-gray-100 text-gray-500',
  trial: 'bg-blue-100 text-blue-700',
  paid: 'bg-teal-light text-teal',
  overdue: 'bg-coral-light text-coral',
};

export function Badge({ label, variant }: { label: string; variant: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${VARIANTS[variant] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}
