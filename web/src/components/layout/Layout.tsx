import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import { CommandPalette } from '../CommandPalette';
import { setTheme } from '../../lib/theme';
import {
  LayoutDashboard, Calendar, Users, CreditCard, BookOpen,
  LogOut, Menu, X, Bell, GraduationCap, CheckCheck, Music, IndianRupee, CalendarClock,
  CalendarDays, CalendarOff, Home, MapPin, BarChart3, ClipboardList, Search, Sun, Moon
} from 'lucide-react';

const coordinatorNav = [
  { group: 'Main', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/schedule', label: 'Schedule', icon: Calendar },
    { to: '/students', label: 'Students', icon: Users },
    { to: '/enrolments', label: 'Enrolments', icon: ClipboardList },
  ]},
  { group: 'Teaching', items: [
    { to: '/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/teacher-schedules', label: 'Teacher Schedules', icon: CalendarClock },
    { to: '/curriculum', label: 'Curriculum', icon: BookOpen },
  ]},
  { group: 'Finance', items: [
    { to: '/payments', label: 'Payments', icon: CreditCard },
    { to: '/lesson-rates', label: 'Lesson Rates', icon: IndianRupee },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
  ]},
  { group: 'Studio', items: [
    { to: '/locations', label: 'Locations', icon: MapPin },
    { to: '/breaks', label: 'Breaks', icon: CalendarOff },
  ]},
];

const teacherNav = [
  { group: '', items: [
    { to: '/', label: 'Schedule', icon: Calendar },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/curriculum', label: 'Curriculum', icon: BookOpen },
  ]},
];

const studentNav = [
  { group: '', items: [
    { to: '/', label: 'Home', icon: Home },
    { to: '/lessons', label: 'My Lessons', icon: Music },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/payments', label: 'Payments', icon: CreditCard },
  ]},
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(profile?.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    setTheme(next);
    setDark(next === 'dark');
  };
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = profile?.role === 'teacher' ? teacherNav
    : profile?.role === 'student' ? studentNav
    : coordinatorNav;

  const roleLabel = profile?.role === 'teacher' ? 'Teacher'
    : profile?.role === 'student' ? 'Student'
    : 'Admin';

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // ⌘K / Ctrl+K opens the command palette anywhere in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white/70 backdrop-blur-xl border-r border-black/5 flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        <div className="relative px-5 pt-6 pb-4 border-b border-black/5">
          <div className="flex flex-col items-center">
            <img src="/logo.png" alt="Troika Music Lessons" className="h-16 w-auto" />
            <span className="mt-2 text-xs text-teal font-semibold tracking-wide uppercase">{roleLabel}</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute top-4 right-4 text-gray-400 hover:text-navy"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {navItems.map((section, si) => (
            <div key={si} className={si > 0 ? 'mt-4' : ''}>
              {section.group && (
                <p className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-gray-400">{section.group}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-teal/10 text-teal font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-teal'
                          : 'text-gray-600 font-medium hover:bg-black/5 hover:text-navy'
                      }`
                    }
                  >
                    <Icon size={18} strokeWidth={1.9} />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-black/5">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-black/[0.03] border border-black/5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 grid place-items-center text-white text-xs font-bold flex-shrink-0">
              {(profile?.full_name || '?').split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-navy truncate leading-tight">{profile?.full_name || 'Account'}</p>
              <p className="text-[11px] text-gray-500 leading-tight">{roleLabel}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-coral p-1.5 rounded-lg hover:bg-coral/10"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-coral focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
          Skip to content
        </a>
        <header className="bg-white/70 backdrop-blur-xl border-b border-black/5 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between flex-shrink-0 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-navy lg:hidden" aria-label="Toggle menu">
            <Menu size={22} />
          </button>
          <img src="/logo.png" alt="Troika Music Lessons" className="lg:hidden h-7 w-auto" />
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg bg-gray-100 border border-black/5 text-gray-400 hover:text-gray-600 hover:bg-gray-200/70"
              aria-label="Search"
            >
              <Search size={15} />
              <span className="text-[12.5px]">Search</span>
              <span className="text-[11px] font-semibold bg-white/80 border border-black/5 rounded px-1 py-px">⌘K</span>
            </button>
            <button
              onClick={toggleTheme}
              className="text-gray-500 hover:text-navy p-1.5 rounded-lg hover:bg-black/5"
              aria-label="Toggle theme"
              title="Toggle light / dark"
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative text-gray-500 hover:text-navy"
                aria-label="Notifications"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-coral rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-100 z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <h3 className="font-semibold text-navy text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-xs text-teal hover:underline flex items-center gap-1"
                      >
                        <CheckCheck size={12} /> Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">No notifications</p>
                    ) : (
                      notifications.slice(0, 15).map((notif) => (
                        <div
                          key={notif.id}
                          className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${!notif.read ? 'bg-blue-50/30' : ''}`}
                          onClick={() => markRead(notif.id)}
                        >
                          <div className="flex items-start gap-2">
                            {!notif.read && <div className="w-2 h-2 bg-coral rounded-full mt-1.5 flex-shrink-0" />}
                            <div className={!notif.read ? '' : 'ml-4'}>
                              <p className="text-sm font-medium text-navy">{notif.title}</p>
                              {notif.body && <p className="text-xs text-gray-500 mt-0.5">{notif.body}</p>}
                              <p className="text-xs text-gray-300 mt-1">
                                {new Date(notif.created_at).toLocaleDateString('en-US', {
                                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-auto p-4 sm:p-6">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={navItems.flatMap((s) => s.items).map(({ label, to }) => ({ label, to }))}
        canSearchStudents={profile?.role !== 'student'}
      />
    </div>
  );
}
