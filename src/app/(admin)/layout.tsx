import { getSession } from '@/lib/auth';
import { AppShell, type NavItem } from '@/components/app-shell';

const ADMIN_NAV: NavItem[] = [
  { href: '/admin/exams', label: '考试管理', icon: '📝' },
  { href: '/admin/grading', label: '待阅卷', icon: '🧪' },
  { href: '/admin/review', label: '待复核', icon: '✅' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <AppShell navItems={ADMIN_NAV} userName={session?.name ?? ''} role={session?.role ?? ''}>
      {children}
    </AppShell>
  );
}
