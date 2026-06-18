import { getSession } from '@/lib/auth';
import { AppShell, type NavItem } from '@/components/app-shell';

const EMPLOYEE_NAV: NavItem[] = [
  { href: '/exams', label: '我的考试', icon: '📋' },
  { href: '/results', label: '历史成绩', icon: '📊' },
];

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <AppShell navItems={EMPLOYEE_NAV} userName={session?.name ?? ''} role={session?.role ?? ''}>
      {children}
    </AppShell>
  );
}
