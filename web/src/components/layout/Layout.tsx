import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import {
  LayoutDashboard, Calendar, Users, CreditCard, BookOpen,
  LogOut, Menu, X, Bell, GraduationCap, CheckCheck, Music, IndianRupee, ClipboardList, CalendarClock,
  CalendarDays, CalendarOff
} from 'lucide-react';

const coordinatorNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/schedule', label: 'Schedule', icon: Calendar },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/teachers', label: 'Teachers', icon: GraduationCap },
  { to: '/teacher-schedules', label: 'Teacher Schedules', icon: CalendarClock },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/lesson-rates', label: 'Lesson Rates', icon: IndianRupee },
  { to: '/enrolments', label: 'Enrolments', icon: ClipboardList },
  { to: '/curriculum', label: 'Curriculum', icon: BookOpen },
  { to: '/breaks', label: 'Breaks', icon: CalendarOff },
];

const teacherNav = [
  { to: '/', label: 'Schedule', icon: Calendar },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/curriculum', label: 'Curriculum', icon: BookOpen },
];

const studentNav = [
  { to: '/', label: 'My Lessons', icon: Music },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(profile?.id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
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
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-logo text-2xl text-navy">troika</h1>
              <span className="text-xs text-teal font-medium">{roleLabel}</span>
            </div>
            <p className="text-xs text-teal mt-0.5">music lessons</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-navy"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-coral/10 text-coral'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-navy'
                }`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100">
          {profile && (
            <p className="text-sm font-medium text-navy mb-2 truncate">{profile.full_name}</p>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 w-full transition-colors"
          >
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-coral focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
          Skip to content
        </a>
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between flex-shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-navy lg:hidden" aria-label="Toggle menu">
            <Menu size={22} />
          </button>
          <div className="lg:hidden font-logo text-lg text-navy">troika</div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-4">
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
    </div>
  );
}
