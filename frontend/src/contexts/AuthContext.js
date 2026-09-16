import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = not auth
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      // Check for token in localStorage first
      const token = localStorage.getItem('trakaquire_token');
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      }
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {
      localStorage.removeItem('trakaquire_token');
      delete api.defaults.headers.common['Authorization'];
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.token) {
      localStorage.setItem('trakaquire_token', data.token);
      api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    }
    setUser(data);
    return data;
  };

  const register = async (email, password, name) => {
    const { data } = await api.post('/auth/register', { email, password, name });
    if (data.token) {
      localStorage.setItem('trakaquire_token', data.token);
      api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    }
    setUser(data);
    return data;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('trakaquire_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
