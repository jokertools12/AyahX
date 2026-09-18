import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import authRouter from '../../server/routes/auth';
import { authenticateToken, signToken } from '../../server/middleware/auth';

const app = express();
app.use(express.json());
app.use(authenticateToken);
app.use('/api/auth', authRouter);

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Auth Endpoints & Password Logic (/api/auth)', () => {
  describe('POST /api/auth/reset-password', () => {
    it('never accepts an email address alone as proof of account ownership', async () => {
      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'account@example.com', newPassword: 'NotAccepted123' }),
      });

      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.error).toContain('استعادة كلمة المرور الآمنة');
    });
  });

  describe('PUT /api/auth/password', () => {
    it('rejects unauthenticated requests without Bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'OldPassword123', newPassword: 'NewPassword123' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('يجب تسجيل الدخول أولاً');
    });

    it('rejects invalid or malformed token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid_garbage_token',
        },
        body: JSON.stringify({ currentPassword: 'OldPassword123', newPassword: 'NewPassword123' }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('يجب تسجيل الدخول أولاً');
    });

    it('validates password length for authenticated user', async () => {
      const testToken = signToken({ id: 'dummy-user-id', email: 'test@example.com' });
      const res = await fetch(`${baseUrl}/api/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`,
        },
        body: JSON.stringify({ currentPassword: 'OldPassword123', newPassword: '123' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('6 أحرف');
    });
  });

  describe('POST /api/auth/login validation', () => {
    it('rejects missing credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('مطلوبان');
    });

    it('returns 400 with clear Arabic error for wrong password or non-existent user', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody_12345@gmail.com', password: 'wrongpassword' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    });
  });
});
