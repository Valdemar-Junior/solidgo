import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

interface TestWrapperProps {
  children: React.ReactNode;
  role: 'admin' | 'driver';
}

export default function TestWrapper({ children, role }: TestWrapperProps) {
  const { user, isAuthenticated, checkAuth } = useAuthStore();

  useEffect(() => {
    // Simulate authentication for testing
    if (!isAuthenticated) {
      const testUser = {
        id: role === 'admin' ? 'test-admin-id' : 'test-driver-id',
        email: role === 'admin' ? 'admin@teste.com' : 'driver@teste.com',
        name: role === 'admin' ? 'Admin Teste' : 'Driver Teste',
        role: role,
        phone: '11999999999',
        created_at: new Date().toISOString(),
      };

      // Set the user directly in the store
      useAuthStore.setState({
        user: testUser,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    }
  }, [role, isAuthenticated]);

  return <>{children}</>;
}