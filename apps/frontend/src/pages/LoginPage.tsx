import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import { useAuthStore } from '../stores/authStore';
import type { LoginResponse, MeResponse } from '../types/api';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const setTokens = useAuthStore((state) => state.setTokens);
  const login = useAuthStore((state) => state.login);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const loginResponse = await apiClient.post<LoginResponse>('/api/auth/login', {
        email,
        password,
      });
      const tokens = {
        accessToken: loginResponse.data.accessToken,
        refreshToken: loginResponse.data.refreshToken,
      };
      // Set tokens first so the request interceptor can attach the bearer token
      // for the /me call below.
      setTokens(tokens);
      const meResponse = await apiClient.get<MeResponse>('/api/auth/me');
      login(tokens, meResponse.data);
    },
    onSuccess: () => navigate('/events', { replace: true }),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div className="auth-page">
      <h1>Log in</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {loginMutation.isError && (
          <p className="form-error">{getErrorMessage(loginMutation.error)}</p>
        )}
        <button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="form-footer">
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
