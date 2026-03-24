export function getMockExternalJsonResponse(url: string): string | null {
    const mocks = (globalThis as unknown as { mockExternalJSON?: Record<string, unknown> }).mockExternalJSON;
    if (!mocks) return null;

    for (const [key, value] of Object.entries(mocks)) {
        if (url.includes(key)) {
            return typeof value === 'string' ? value : JSON.stringify(value);
        }
    }

    return null;
}
