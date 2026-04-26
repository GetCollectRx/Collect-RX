import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { TOKEN_KEY } from '../utils/api';

interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'readonly';
  practiceId: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Verify stored token on mount
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then((u: AuthUser | null) => {
        if (u) {
          setUser(u);
          setToken(stored);
        } else {
          logout();
        }
      })
      .catch(() => logout())
      .finally(() => setIsLoading(false));
  }, [logout]);

  // Listen for 401s emitted by apiFetch
  useEffect(() => {
    const handle = () => logout();
    window.addEventListener('collectrx:unauthorized', handle);
    return () => window.removeEventListener('collectrx:unauthorized', handle);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Login failed');

    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
