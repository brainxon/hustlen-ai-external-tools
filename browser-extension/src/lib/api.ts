import { API_BASE_URL } from './config';
import type {
  ApplicationLookup,
  DocumentKind,
  DocumentStatus,
  ApplicationStatus,
  ExtensionProfile,
  ExtractedJob,
  PlanSummary,
  ScreeningAnswer,
  ScreeningQuestion,
} from './types';

/**
 * Typed client for the hustlen.ai REST API. Callers inject a token
 * provider, so this runs in the background script (which owns the tokens)
 * and in the side panel (which asks the background for a token and then
 * streams the tailoring pipeline itself). Extension pages and the service
 * worker hold host_permissions for the API origin, so no CORS origin is
 * needed on the backend (REQ-EXT-001).
 */

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

function messageFrom(body: any, status: number): { message: string; code?: string } {
  const detail = body?.detail;
  if (typeof detail === 'string') return { message: detail };
  if (detail && typeof detail === 'object') return { message: detail.message || detail.error || `Request failed (${status})`, code: detail.error_code };
  return { message: `Request failed (${status})` };
}

export class HustlenApi {
  constructor(private getToken: TokenProvider, private baseUrl = API_BASE_URL) {}

  private async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = async (force: boolean) => {
      const token = await this.getToken(force);
      if (!token) throw new ApiError('Not connected to hustlen.ai', 401, 'not_connected');
      return fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${token}` },
      });
    };
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    return res;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.authedFetch(path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const { message, code } = messageFrom(body, res.status);
      throw new ApiError(message, res.status, code);
    }
    return body as T;
  }

  getProfile(cvSource?: string | null): Promise<ExtensionProfile> {
    const q = cvSource ? `?cv_source=${encodeURIComponent(cvSource)}` : '';
    return this.request(`/extension/profile${q}`);
  }

  lookupApplication(url: string): Promise<ApplicationLookup> {
    return this.request(`/extension/applications/lookup?url=${encodeURIComponent(url)}`);
  }

  /**
   * Saves the job on the current page for tracking: the fields the extension
   * extracted, no AI and no plan quota on the backend (REQ-EXT-007). Returns
   * the existing application for the same job URL instead of a duplicate.
   */
  saveJob(job: ExtractedJob): Promise<ApplicationLookup & { existing: boolean }> {
    return this.request('/extension/applications', {
      method: 'POST',
      body: JSON.stringify({
        url: job.url,
        title: job.title.slice(0, 300),
        company: job.company.slice(0, 300),
        location: job.location.slice(0, 300),
        description: job.description.slice(0, 60000),
        source: job.source,
      }),
    });
  }

  /** Job keywords + language before tailoring, only if missing (credit-gated, 402 when exhausted). */
  prepareForTailoring(applicationId: number): Promise<{ prepared: boolean; extracted: boolean }> {
    return this.request(`/extension/applications/${applicationId}/prepare`, { method: 'POST' });
  }

  /** The user's Master CV as PDF (own data, no AI, no review gate) for resume upload fields. */
  async masterCvPdf(cvSource?: string | null): Promise<{ blob: Blob; filename: string }> {
    const q = cvSource ? `?cv_source=${encodeURIComponent(cvSource)}` : '';
    const res = await this.authedFetch(`/extension/cv/master-pdf${q}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const { message, code } = messageFrom(body, res.status);
      throw new ApiError(message, res.status, code);
    }
    const filename = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'CV.pdf';
    return { blob: await res.blob(), filename };
  }

  plan(): Promise<PlanSummary> {
    return this.request('/extension/plan');
  }

  documentStatus(applicationId: number): Promise<DocumentStatus> {
    return this.request(`/extension/applications/${applicationId}/documents`);
  }

  /** Reviewed tailored CV / cover letter as PDF. 403 review_not_confirmed until reviewed in hustlen.ai. */
  async downloadDocument(applicationId: number, kind: DocumentKind): Promise<{ blob: Blob; filename: string }> {
    const res = await this.authedFetch(`/extension/applications/${applicationId}/documents/${kind}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const { message, code } = messageFrom(body, res.status);
      throw new ApiError(message, res.status, code);
    }
    const disposition = res.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || `${kind}.pdf`;
    return { blob: await res.blob(), filename };
  }

  tailoredCv(applicationId: number): Promise<{ cv: import('./types').FlatCv; review_confirmed: boolean }> {
    return this.request(`/extension/applications/${applicationId}/documents/cv/flat`);
  }

  coverLetterText(applicationId: number): Promise<{ text: string; review_confirmed: boolean }> {
    return this.request(`/extension/applications/${applicationId}/documents/cover_letter/text`);
  }

  setStatus(applicationId: number, status: ApplicationStatus): Promise<unknown> {
    return this.request(`/applications/${applicationId}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  }

  answerQuestions(payload: {
    questions: ScreeningQuestion[];
    cv_source?: string | null;
    application_id?: number | null;
    job_title?: string;
    company_name?: string;
    job_description?: string;
  }): Promise<{ answers: ScreeningAnswer[] }> {
    return this.request('/extension/answer-questions', { method: 'POST', body: JSON.stringify(payload) });
  }

  /**
   * Tailored CV + cover letter via the SSE pipeline endpoint. Calls onEvent
   * for each `data:` event ({type: started|progress|complete|error|cancelled}).
   */
  async streamTailor(
    applicationId: number,
    source: { user_cv_id?: number | null; root_cv_language?: string | null },
    onEvent: (event: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.authedFetch(`/applications/${applicationId}/pipeline/start-stream`, {
      method: 'POST',
      body: JSON.stringify(source),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      const { message, code } = messageFrom(body, res.status);
      throw new ApiError(message, res.status, code);
    }
    await readSse(res.body, onEvent);
  }
}

export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: any) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          onEvent(JSON.parse(data));
        } catch {
          /* ignore keep-alives / malformed chunks */
        }
      }
    }
  }
}
