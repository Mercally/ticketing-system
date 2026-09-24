import { Link, Outlet, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';
import { useCheckoutStore } from '../stores/checkoutStore';

export function Layout() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const clearCheckout = useCheckoutStore((state) => state.clear);
  const navigate = useNavigate();

  const handleLogout = () => {
    // Best-effort server-side invalidation of the refresh token; the client-side
    // session clears regardless of whether this call succeeds.
    if (refreshToken) {
      apiClient.post('/api/auth/logout', { refreshToken }).catch(() => {});
    }
    logout();
    clearCheckout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/events" className="brand">
          TicketHub
        </Link>
        <nav className="app-nav">
          {accessToken ? (
            <>
              <Link to="/events">Events</Link>
              <span className="app-user">{user?.displayName ?? user?.email}</span>
              <button type="button" className="link-button" onClick={handleLogout}>
                Logout
              </button>
            </>
          ) : (
            <Link to="/login">Login</Link>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
