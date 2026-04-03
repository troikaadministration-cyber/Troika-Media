import React, { useState, useEffect } from 'react';
import { Search, Music, MapPin, Calendar, Mail, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile } from '@troika/shared';

interface TeacherWithStats extends Profile {
  lesson_count?: number;
  student_count?: number;
  instruments?: string[];
  locations?: string[];
}

export function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherWithStats[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeachers();
  }, []);

  async function fetchTeachers() {
    setLoading(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'teacher')
      .order('full_name');

    const enriched = await Promise.all(
      (profiles || []).map(async (teacher) => {
        const [lessonsRes, studentsRes] = await Promise.all([
          supabase
            .from('lessons')
            .select('id, instrument:instruments(name), location:locations(name)')
            .eq('teacher_id', teacher.id),
          supabase
            .from('lesson_students')
            .select('student_id, lesson:lessons!inner(teacher_id)')
            .eq('lesson.teacher_id', teacher.id),
        ]);

        const lessons = lessonsRes.data || [];
        const instrumentSet = new Set(
          lessons.map((l: any) => l.instrument?.name).filter(Boolean)
        );
        const locationSet = new Set(
          lessons.map((l: any) => l.location?.name).filter(Boolean)
        );
        const studentSet = new Set(
          (studentsRes.data || []).map((s: any) => s.student_id)
        );

        return {
          ...teacher,
          lesson_count: lessons.length,
          student_count: studentSet.size,
          instruments: [...instrumentSet] as string[],
          locations: [...locationSet] as string[],
        };
      })
    );

    setTeachers(enriched);
    setLoading(false);
  }

  const filtered = teachers.filter((t) =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Teachers</h1>
        <p className="text-gray-500 text-sm mt-1">{teachers.length} teachers</p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search teachers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Teacher cards */}
      {loading ? (
        <p className="text-center text-gray-400 py-12">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No teachers found</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((teacher) => (
            <div key={teacher.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-navy text-lg">{teacher.full_name}</h3>
                  <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                    <Mail size={12} />
                    <span>{teacher.email}</span>
                  </div>
                  {teacher.phone && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                      <Phone size={12} />
                      <span>{teacher.phone}</span>
                    </div>
                  )}
                </div>
                <div className="w-10 h-10 bg-coral-light rounded-full flex items-center justify-center">
                  <span className="text-coral font-bold text-sm">
                    {teacher.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-1.5 text-sm">
                  <Calendar size={14} className="text-teal" />
                  <span className="text-navy font-semibold">{teacher.lesson_count}</span>
                  <span className="text-gray-400">lessons</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <Music size={14} className="text-coral" />
                  <span className="text-navy font-semibold">{teacher.student_count}</span>
                  <span className="text-gray-400">students</span>
                </div>
              </div>

              {teacher.instruments && teacher.instruments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {teacher.instruments.map((inst) => (
                    <span key={inst} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-navy text-white">
                      {inst}
                    </span>
                  ))}
                </div>
              )}

              {teacher.locations && teacher.locations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {teacher.locations.map((loc) => (
                    <span key={loc} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-1">
                      <MapPin size={10} />
                      {loc}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
