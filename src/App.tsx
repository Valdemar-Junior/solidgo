import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import Login from './pages/Login';
import Register from './pages/Register';
import TestLogin from './pages/TestLogin';
import CheckUsers from './pages/CheckUsers';
import Setup from './pages/Setup';
import AdminDashboard from './pages/admin/Dashboard';
import Settings from './pages/admin/Settings';
import DriverDashboard from './pages/driver/Dashboard';
import DriverRouteDetails from './pages/driver/RouteDetails';
import OrdersImport from './pages/admin/OrdersImport';
import RouteCreation from './pages/admin/RouteCreation';
import ProtectedRoute from './components/ProtectedRoute';
import { Toaster } from 'sonner';

function App() {
  const { checkAuth, isLoading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/test-login" element={<TestLogin />} />
          <Route path="/check-users" element={<CheckUsers />} />
          <Route path="/setup" element={<Setup />} />
          
          {/* Rotas de teste removidas para fluxo profissional */}
          
          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/orders"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <OrdersImport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/routes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <RouteCreation />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <Settings />
              </ProtectedRoute>
            }
          />
          
          {/* Driver Routes */}
          <Route
            path="/driver"
            element={
              <ProtectedRoute allowedRoles={['driver']}>
                <DriverDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/driver/route/:routeId"
            element={
              <ProtectedRoute allowedRoles={['driver']}>
                <DriverRouteDetails />
              </ProtectedRoute>
            }
          />
          
          {/* Default redirect based on role */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RoleBasedRedirect />
              </ProtectedRoute>
            }
          />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
      
      <Toaster
        position="top-right"
        expand={false}
        richColors
        closeButton
        duration={4000}
      />
    </>
  );
}

function RoleBasedRedirect() {
  const { user } = useAuthStore();
  
  console.log('RoleBasedRedirect - Current user:', user);
  
  if (!user) {
    console.log('No user found, redirecting to login');
    return <Navigate to="/login" replace />;
  }
  
  console.log('User found, redirecting based on role:', user.role);
  return user.role === 'admin' 
    ? <Navigate to="/admin" replace /> 
    : <Navigate to="/driver" replace />;
}

export default App;
