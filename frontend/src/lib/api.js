import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor for auth - avoid redirect loops
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const isAuthRoute = error.config?.url?.includes('/auth/');
    if (error.response?.status === 401 && !error.config._retry && !isAuthRoute) {
      error.config._retry = true;
      try {
        await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true });
        return api(error.config);
      } catch {
        // Don't redirect, let AuthContext handle it
      }
    }
    return Promise.reject(error);
  }
);

export function formatApiError(detail) {
  if (detail == null) return 'Algo deu errado. Tente novamente.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(e => e?.msg || JSON.stringify(e)).join(' ');
  if (detail?.msg) return detail.msg;
  return String(detail);
}

export default api;
