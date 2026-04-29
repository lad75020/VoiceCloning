import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  id: string;
  username: string;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly baseUrl = '/api/auth';
  private readonly tokenKey = 'voice-cloning.auth-token.v1';

  readonly token = signal<string | null>(this.loadToken());
  readonly user = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());

  constructor(private http: HttpClient) {}

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.baseUrl}/login`, { username, password }),
    );
    this.setSession(res.token, res.user);
  }

  async logout(): Promise<void> {
    const headers = this.authHeaders();
    this.clearSession();
    if (headers) {
      await firstValueFrom(this.http.post(`${this.baseUrl}/logout`, {}, { headers })).catch(() => null);
    }
  }

  async refreshSession(): Promise<void> {
    const headers = this.authHeaders();
    if (!headers) return;

    try {
      const res = await firstValueFrom(
        this.http.get<{ user: AuthUser }>(`${this.baseUrl}/me`, { headers }),
      );
      this.user.set(res.user);
    } catch {
      this.clearSession();
    }
  }

  authHeaders(): HttpHeaders | undefined {
    const currentToken = this.token();
    return currentToken ? new HttpHeaders({ Authorization: `Bearer ${currentToken}` }) : undefined;
  }

  private setSession(token: string, user: AuthUser): void {
    this.token.set(token);
    this.user.set(user);
    if (this.canUseLocalStorage()) {
      window.localStorage.setItem(this.tokenKey, token);
    }
  }

  private clearSession(): void {
    this.token.set(null);
    this.user.set(null);
    if (this.canUseLocalStorage()) {
      window.localStorage.removeItem(this.tokenKey);
    }
  }

  private loadToken(): string | null {
    if (!this.canUseLocalStorage()) return null;
    return window.localStorage.getItem(this.tokenKey);
  }

  private canUseLocalStorage(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch {
      return false;
    }
  }
}
