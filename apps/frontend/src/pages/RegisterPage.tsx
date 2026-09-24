import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/apiClient';
import { getErrorMessage } from '../lib/errors';
import type { RegisterResponse } from '../types/api';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const navigate = useNavigate();

  const registerMutation = useMutation({
    mutationFn: () =>
      apiClient.post<RegisterResponse>('/api/auth/register', { email, password, displayName }),
    onSuccess: () => navigate('/login', { replace: true }),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    registerMutation.mutate();
  };

  return (
    <div className="auth-page">
      <h1>Create an account</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        {registerMutation.isError && (
          <p className="form-error">{getErrorMessage(registerMutation.error)}</p>
        )}
        <button type="submit" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? 'Creating account…' : 'Register'}
        </button>
      </form>
      <p className="form-footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
