import { AuthProvider } from "@/components/AuthProvider";
import { AdminProvider } from "@/components/AdminProvider";
import { DashboardLayout } from "@/components/layout/dashboard-layout";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AdminProvider>
        <DashboardLayout>
          {children}
        </DashboardLayout>
      </AdminProvider>
    </AuthProvider>
  );
}
