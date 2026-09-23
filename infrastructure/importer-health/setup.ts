import { afterAll, vi } from 'vitest';
import { Window } from 'happy-dom';

const healthWindow = new Window({
    settings: {
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        handleDisabledFileLoadingAsSuccess: true,
    },
});
vi.stubGlobal('DOMParser', healthWindow.DOMParser);

vi.mock('@tauri-apps/api/core', () => ({
    invoke: async <T,>(command: string, rawArgs?: unknown): Promise<T> => {
        if (command !== 'fetch_external_json') {
            throw new Error(`Importer health tests only support fetch_external_json, received ${command}`);
        }

        const args = rawArgs as {
            url?: unknown;
            method?: unknown;
            body?: unknown;
            headers?: unknown;
        } | undefined;
        if (!args || typeof args.url !== 'string' || typeof args.method !== 'string') {
            throw new Error('fetch_external_json received an invalid request');
        }

        const body = typeof args.body === 'string' ? args.body : undefined;
        const headers = new Headers(isHeaderRecord(args.headers) ? args.headers : undefined);
        if (body !== undefined && !headers.has('content-type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(args.url, {
            method: args.method,
            body,
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(45_000),
        });
        const responseText = await response.text();

        if (!response.ok) {
            const excerpt = responseText.replaceAll(/\s+/g, ' ').trim().slice(0, 200);
            const detail = excerpt ? `: ${excerpt}` : '';
            throw new Error(`Remote request returned HTTP ${response.status} for ${args.url}${detail}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const inertResponseText = contentType.includes('text/html')
            ? removeIframes(responseText)
            : responseText;
        return inertResponseText as T;
    },
}));

function isHeaderRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every(headerValue => typeof headerValue === 'string');
}

function removeIframes(html: string): string {
    return html
        .replaceAll(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
        .replaceAll(/<iframe\b[^>]*\/?>/gi, '');
}

afterAll(() => {
    healthWindow.close();
    vi.unstubAllGlobals();
});
