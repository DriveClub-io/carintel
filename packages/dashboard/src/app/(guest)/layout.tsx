import { AuthProvider } from "@/components/AuthProvider";

export default function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen flex items-center justify-center bg-background">
        {children}
      </div>
    </AuthProvider>
  );
}
