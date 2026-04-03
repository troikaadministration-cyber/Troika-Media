import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonRate, Location } from '@troika/shared';

// ── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear().toString();
const YEARS = [CURRENT_YEAR, (Number(CURRENT_YEAR) - 1).toString()];

interface CategoryRow {
  value: string;   // matches LessonCategory enum values
  label: string;
  group: '1:1' | 'group';
}

const CATEGORIES: CategoryRow[] = [
  { value: '1:1_instrumental', label: 'Instrumental',   group: '1:1' },
  { value: '1:1_theory',       label: 'Theory',         group: '1:1' },
  { value: '1:1_vocals',       label: 'Vocals',         group: '1:1' },
  { value: 'group_strings',    label: 'Cello / Violin', group: 'group' },
  { value: 'group_guitar',     label: 'Guitar',         group: 'group' },
  { value: 'group_vocals',     label: 'Vocals',         group: 'group' },
  { value: 'group_theory',     label: 'Theory',         group: 'group' },
];

interface Teacher { id: string; full_name: string; }

// ── RateKey: unique key for a (category, locationId|'online') cell ──────────
function rateKey(category: string, locationId: string | null) {
  return `${category}::${locationId ?? 'online'}`;
}

export function LessonRatesPage() {
  return <div>TODO</div>;
}
