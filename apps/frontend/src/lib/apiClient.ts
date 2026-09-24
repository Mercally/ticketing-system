import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { useCheckoutStore } from '../stores/checkoutStore';
import type { RefreshResponse } from '../types/api';

// The frontend talks ONLY to the Gateway (docs/CONTRACTS.md §1). Every downstream
// service is reached as /api/<service>/<rest-of-path>, with the gateway stripping
// the /api/<service> prefix before proxying.
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:5000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Request interceptor: attach the bearer token (if any) and the current
// checkout flow's X-Correlation-Id (if one has been minted yet). See
// docs/CONTRACTS.md §2 and src/stores/checkoutStore.ts for the correlation id
// lifecycle. Idempotency-Key is intentionally NOT handled here — it's a
// per-action concern generated at each reserve/order call site (see
// EventDetailPage / CheckoutPage), not a per-request cross-cutting header.
apiClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const { correlationId } = useCheckoutStore.getState();
  if (correlationId) {
    config.headers.set('X-Correlation-Id', correlationId);
  }

  return config;
});

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Single in-flight refresh shared across any requests that 401 concurrently, so a
// burst of simultaneous 401s only triggers one POST /api/auth/refresh call.
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  // Plain axios (not apiClient) — avoids feeding a stale Authorization header
  // into the refresh call and avoids re-entering this same response interceptor.
  const response = await axios.post<RefreshResponse>(`${API_BASE_URL}/api/auth/refresh`, {
    refreshToken,
  });

  useAuthStore.getState().setTokens({
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
  });

  return response.data.accessToken;
}

// Response interceptor: on 401, try refreshing the access token once and retry
// the original request; if refresh also fails, clear the session and bounce to
// /login.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        refreshInFlight ??= refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
        const newAccessToken = await refreshInFlight;

        originalRequest.headers.set('Authorization', `Bearer ${newAccessToken}`);
        return await apiClient.request(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);
