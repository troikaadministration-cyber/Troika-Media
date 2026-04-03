import React from 'react';

interface Props {
  children: React.ReactNode;
  borderColor?: string;
  className?: string;
}

export function Card({ children, borderColor, className = '' }: Props) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 ${className}`}
      style={borderColor ? { borderLeft: `4px solid ${borderColor}` } : undefined}
    >
      {children}
    </div>
  );
}
