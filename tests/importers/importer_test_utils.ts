import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { MetadataImporter, ScrapedMetadata } from '../../src/importers';

type UrlMatchCase = {
    url: string;
    contentType?: string;
    expected?: boolean;
};

type ExpectedMetadata = Partial<Pick<ScrapedMetadata, 'title' | 'description' | 'coverImageUrl' | 'contentType'>> & {
    extraData?: Record<string, string>;
};

type MockedImportOptions = {
    url: string;
    targetVolume?: number;
    expected: ExpectedMetadata;
} & (
    | { response: string; responses?: never }
    | { responses: string[]; response?: never }
);

export const mockedInvoke = vi.mocked(invoke);

export function describeImporter<T extends MetadataImporter>(
    name: string,
    createImporter: () => T,
    defineTests: (getImporter: () => T) => void,
): void {
    let importer = createImporter();

    describe(name, () => {
        beforeEach(() => {
            importer = createImporter();
            vi.clearAllMocks();
        });

        defineTests(() => importer);
    });
}

export function itMatchesUrls<T extends MetadataImporter>(
    label: string,
    getImporter: () => T,
    cases: UrlMatchCase[],
): void {
    it(label, () => {
        for (const testCase of cases) {
            expect(getImporter().matchUrl(testCase.url, testCase.contentType)).toBe(testCase.expected ?? true);
        }
    });
}

export function htmlDocument({ head = '', body = '' }: { head?: string; body?: string }): string {
    return `<html><head>${head}</head><body>${body}</body></html>`;
}

export function mockFetchResponse(response: string): void {
    mockedInvoke.mockResolvedValue(response);
}

export function mockFetchResponses(responses: string[]): void {
    for (const response of responses) {
        mockedInvoke.mockResolvedValueOnce(response);
    }
}

export async function expectMockedImport<T extends MetadataImporter>(
    importer: T,
    options: MockedImportOptions,
): Promise<ScrapedMetadata> {
    if ('responses' in options) {
        mockFetchResponses(options.responses);
    } else {
        mockFetchResponse(options.response);
    }

    const result = await importer.fetch(options.url, options.targetVolume);
    expectMetadata(result, options.expected);
    return result;
}

export function expectMetadata(result: ScrapedMetadata, expected: ExpectedMetadata): void {
    if (expected.title !== undefined) expect(result.title).toBe(expected.title);
    if (expected.description !== undefined) expect(result.description).toBe(expected.description);
    if (expected.coverImageUrl !== undefined) expect(result.coverImageUrl).toBe(expected.coverImageUrl);
    if (expected.contentType !== undefined) expect(result.contentType).toBe(expected.contentType);
    if (expected.extraData) expect(result.extraData).toEqual(expect.objectContaining(expected.extraData));
}
