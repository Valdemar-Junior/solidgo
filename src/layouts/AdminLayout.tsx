import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
    LayoutDashboard,
    PackageSearch,
    Truck,
    Hammer,
    FileSpreadsheet,
    Users,
    Settings,
    ShieldAlert,
    BookMarked,
    LogOut,
    Menu,
    X,
    UserCircle,
    Bell,
    Box,
    CarFront
} from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { user, logout } = useAuthStore();
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [location.pathname]);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const navigationItems = [
        { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { name: 'Pedidos (Importar)', href: '/admin/orders', icon: Box },
        { name: 'Consulta de Pedido', href: '/admin/order-lookup', icon: PackageSearch },
        { name: 'Gestão de Entregas', href: '/admin/routes', icon: Truck },
        { name: 'Gestão de Montagem', href: '/admin/assembly', icon: Hammer },
        { name: 'Controle de Frota', href: '/admin/fleet', icon: CarFront },
        { name: 'Relatórios', href: '/admin/reports', icon: FileSpreadsheet },
        { name: 'Cadastros e Equipes', href: '/admin/users-teams', icon: Users },
        { name: 'Configurações', href: '/admin/settings', icon: Settings },
        { name: 'Auditoria', href: '/admin/audit', icon: ShieldAlert },
        { name: 'Diário de Bordo', href: '/admin/diary', icon: BookMarked },
    ];

    const currentRoute = navigationItems.find((item) => item.href === location.pathname) || { name: 'Painel Administrativo' };

    return (
        <div className="min-h-screen bg-gray-50 flex overflow-hidden">
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden transition-opacity"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            <aside
                className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#0B1E36] transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="h-16 flex items-center justify-between px-6 bg-[#0B1E36] border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600 p-2 rounded-lg shadow-sm shadow-blue-900/50">
                            <Truck className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-xl font-bold text-white tracking-wide">SOLID<span className="text-blue-400">GO</span></span>
                    </div>
                    <button
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="p-1 text-gray-400 hover:text-white lg:hidden rounded"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    <div className="space-y-1">
                        {navigationItems.map((item) => {
                            const isActive = location.pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    to={item.href}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${isActive
                                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                                        }`}
                                >
                                    <item.icon
                                        className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-400'
                                            }`}
                                    />
                                    {item.name}
                                </Link>
                            );
                        })}
                    </div>
                </div>

                <div className="p-4 border-t border-white/10 shrink-0 bg-[#0B1E36]">
                    <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-white/5 border border-white/5">
                        <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                            <span className="text-sm font-bold text-white">
                                {user?.name?.charAt(0).toUpperCase() || 'A'}
                            </span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{user?.name || 'Administrador'}</p>
                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors shrink-0"
                            title="Sair"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </aside>

            <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 z-10 shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg lg:hidden"
                        >
                            <Menu className="h-6 w-6" />
                        </button>
                        <h1 className="text-xl font-semibold text-gray-800 lg:hidden">
                            SOLIDGO
                        </h1>
                        <h1 className="text-xl font-semibold text-gray-800 hidden lg:block">
                            {currentRoute.name}
                        </h1>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4">
                        <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors relative">
                            <Bell className="h-5 w-5" />
                            <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full border border-white"></span>
                        </button>

                        <div className="h-6 w-px bg-gray-200 mx-1"></div>

                        <div className="flex items-center gap-2">
                            <div className="hidden sm:block text-right">
                                <p className="text-sm font-medium text-gray-900 leading-none">{user?.name || 'Admin'}</p>
                                <p className="text-xs text-gray-500 mt-1">{user?.role === 'admin' ? 'Gestor' : 'Usuário'}</p>
                            </div>
                            <UserCircle className="h-8 w-8 text-gray-400" />
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-auto bg-gray-50">
                    {children}
                </main>
            </div>
        </div>
    );
}
