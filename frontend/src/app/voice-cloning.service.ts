import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface UploadVoiceResponse {
  voiceId: string;
  language: string;
}

export interface GenerateRequest {
  jobId: string;
  voiceId: string;
  text: string;
  language: string;
  engine: string;
}

@Injectable({ providedIn: 'root' })
export class VoiceCloningService {
  private readonly baseUrl = '/api';

  constructor(
    private http: HttpClient,
    private auth: AuthService,
  ) {}

  uploadVoice(audio: Blob, language: string): Observable<UploadVoiceResponse> {
    const form = new FormData();
    form.append('audio', audio, 'voice.webm');
    form.append('language', language);
    return this.http.post<UploadVoiceResponse>(`${this.baseUrl}/upload-voice`, form, {
      headers: this.auth.authHeaders(),
    });
  }

  generate(req: GenerateRequest): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.baseUrl}/generate`, req, {
      headers: this.auth.authHeaders(),
      responseType: 'blob',
      observe: 'response',
    });
  }

  cancelGeneration(jobId: string): Observable<{ ok: boolean; status: string; jobId: string }> {
    return this.http.post<{ ok: boolean; status: string; jobId: string }>(
      `${this.baseUrl}/generate/${jobId}/cancel`,
      {},
      { headers: this.auth.authHeaders() },
    );
  }
}
