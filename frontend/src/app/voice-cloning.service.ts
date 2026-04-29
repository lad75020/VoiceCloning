import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface UploadVoiceResponse {
  voiceId: string;
  language: string;
}

export interface GenerateRequest {
  voiceId: string;
  text: string;
  language: string;
  engine: string;
}

@Injectable({ providedIn: 'root' })
export class VoiceCloningService {
  private readonly baseUrl = '/api';

  constructor(private http: HttpClient) {}

  uploadVoice(audio: Blob, language: string): Observable<UploadVoiceResponse> {
    const form = new FormData();
    form.append('audio', audio, 'voice.webm');
    form.append('language', language);
    return this.http.post<UploadVoiceResponse>(`${this.baseUrl}/upload-voice`, form);
  }

  generate(req: GenerateRequest): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.baseUrl}/generate`, req, {
      responseType: 'blob',
      observe: 'response',
    });
  }
}
