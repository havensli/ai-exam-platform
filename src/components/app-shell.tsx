'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const ROLE_LABELS: Record<string, string> = {
  system_admin: '系统管理员',
  exam_creator: '出题人',
  reviewer: '阅卷人',
  employee: '员工',
};

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  // /auth/login only auto-logs in when opened inside the DingTalk client;
  // outside of it (the desktop testing flow in use right now) it just shows
  // a manual authCode paste box with no way to get one. /auth/qrlogin is the
  // actual usable re-entry point for that case.
  window.location.href = '/auth/qrlogin';
}

export function AppShell({
  navItems,
  userName,
  role,
  children,
}: {
  navItems: NavItem[];
  userName: string;
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 bg-brand-600">
          <span className="font-bold text-white text-lg">AI 考试系统</span>
        </div>
        <nav className="flex-1 py-3 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-2 text-sm mx-2 rounded-lg transition ${
                  active ? 'bg-brand-50 text-brand-600 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-end px-6 gap-4 text-sm shrink-0">
          <span className="text-gray-500">
            {userName}
            {role && <span className="text-gray-400">（{ROLE_LABELS[role] ?? role}）</span>}
          </span>
          <button onClick={handleLogout} className="text-gray-500 hover:text-red-600 transition">
            退出登录
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
