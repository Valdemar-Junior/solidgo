import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from 'react';
import { envOk } from './supabase/client';
import { useAuthStore } from './stores/authStore';
import Login from './pages/Login';
import Register from './pages/Register';
import TestLogin from './pages/TestLogin';
import CheckUsers from './pages/CheckUsers';
import Setup from './pages/Setup';
import FirstLogin from './pages/FirstLogin';
import AdminDashboard from './pages/admin/Dashboard';
import Settings from './pages/admin/Settings';
import UsersTeams from './pages/admin/UsersTeams';
import DriverDashboard from './pages/driver/Dashboard';
import DriverRouteDetails from './pages/driver/RouteDetails';
import ConferenteDashboard from './pages/conferente/Dashboard';
import ConferenteRouteConference from './pages/conferente/RouteConference';
import OrdersImport from './pages/admin/OrdersImport';
import RouteCreation from './pages/admin/RouteCreation';
import AssemblyManagement from './pages/admin/AssemblyManagement';
import AssemblyDashboard from './pages/montador/AssemblyDashboard';
import TesteImportacao from './pages/teste-importacao';
import DiagnosticoOrders from './pages/diagnostico-orders';
import VerificarColunasOrders from './pages/verificar-colunas';
import ProtectedRoute from './components/ProtectedRoute';
import { Toaster } from 'sonner';
import AppErrorBoundary from './components/AppErrorBoundary';

function App() {
  const { checkAuth, isLoading } = useAuthStore();

  if (!envOk) {
    return <Setup />;
  }

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
    <AppErrorBoundary>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/test-login" element={<TestLogin />} />
          <Route path="/check-users" element={<CheckUsers />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/first-login" element={<FirstLogin />} />
          <Route path="/teste-importacao" element={<TesteImportacao />} />
          <Route path="/diagnostico-orders" element={<DiagnosticoOrders />} />
          <Route path="/verificar-colunas" element={<VerificarColunasOrders />} />
          
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
          <Route
            path="/admin/users-teams"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UsersTeams />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/assembly"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AssemblyManagement />
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
          
          {/* Montador Routes */}
          <Route
            path="/montador"
            element={
              <ProtectedRoute allowedRoles={['montador']}>
                <AssemblyDashboard />
              </ProtectedRoute>
            }
          />
          {/* Conferente Routes */}
          <Route
            path="/conferente"
            element={
              <ProtectedRoute allowedRoles={['conferente']}>
                <ConferenteDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/conferente/route/:routeId"
            element={
              <ProtectedRoute allowedRoles={['conferente']}>
                <ConferenteRouteConference />
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
    </AppErrorBoundary>
  );
}

function RoleBasedRedirect() {
  const { user } = useAuthStore();
  
  console.log('RoleBasedRedirect - Current user:', user);
  
  if (!user) {
    console.log('No user found, redirecting to login');
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Redirecionando para o login...</p>
          <a href="/login" className="text-blue-600 underline">Ir para login agora</a>
        </div>
      </div>
    );
  }
  
  if (user.must_change_password) {
    return <Navigate to="/first-login" replace />;
  }
  console.log('User found, redirecting based on role:', user.role);
  return user.role === 'admin' 
    ? <Navigate to="/admin" replace /> 
    : user.role === 'driver' 
      ? <Navigate to="/driver" replace />
      : user.role === 'conferente'
        ? <Navigate to="/conferente" replace />
        : <Navigate to="/driver" replace />;
}

export default App;
