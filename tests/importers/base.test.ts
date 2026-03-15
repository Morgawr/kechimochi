import { describe, it, expect, vi } from 'vitest';
import { BaseImporter } from '../../src/importers/base';
import { ScrapedMetadata } from '../../src/importers/index';
import { invoke } from '@tauri-apps/api/core';

// Concrete implementation for testing
class MockImporter extends BaseImporter {
    name = "Mock";
    supportedContentTypes = ["Any"];
    matchUrl(_url: string): boolean { return true; }
    async fetch(_url: string): Promise<ScrapedMetadata> {
        return {
            title: "Mock",
            description: "Mock",
            coverImageUrl: "Mock",
            extraData: this.createExtraData(_url)
        };
    }

    // Expose protected methods for testing
    public async testFetchHtml(url: string, headers?: Record<string, string>) {
        return this.fetchHtml(url, headers);
    }

    public testParseHtml(html: string) {
        return this.parseHtml(html);
    }

    public testCreateExtraData(url: string, initialData?: Record<string, string>) {
        return this.createExtraData(url, initialData);
    }

    public testSanitizeDescription(description: string) {
        return this.sanitizeDescription(description);
    }
}

describe('BaseImporter', () => {
    it('createExtraData should add source tag with importer name', () => {
        const importer = new MockImporter();
        const extra = importer.testCreateExtraData('https://example.com', { 'Rating': '5' });
        expect(extra['Source (Mock)']).toBe('https://example.com');
        expect(extra['Rating']).toBe('5');
    });

    it('createExtraData should work with empty initial data', () => {
        const importer = new MockImporter();
        const extra = importer.testCreateExtraData('https://example.com');
        expect(extra).toEqual({
            'Source (Mock)': 'https://example.com'
        });
    });

    it('parseHtml should return a Document object', () => {
        const importer = new MockImporter();
        const doc = importer.testParseHtml('<html><body><div id="test">Hello World</div></body></html>');
        expect(doc.nodeType).toBe(9); // Node.DOCUMENT_NODE
        expect(doc.getElementById('test')?.textContent).toBe('Hello World');
    });

    it('fetchHtml should invoke fetch_external_json and return parsed Document', async () => {
        const importer = new MockImporter();
        const mockHtml = '<html><head><title>Test Page</title></head><body>Content</body></html>';
        
        vi.mocked(invoke).mockResolvedValue(mockHtml);
        
        const testUrl = 'https://some-api.com/page';
        const testHeaders = { 'X-Test': 'true' };
        
        const doc = await importer.testFetchHtml(testUrl, testHeaders);
        
        expect(doc.title).toBe('Test Page');
        expect(invoke).toHaveBeenCalledWith('fetch_external_json', {
            url: testUrl,
            method: 'GET',
            body: undefined,
            headers: testHeaders
        });
    });

    it('fetchHtml should work without optional headers', async () => {
        const importer = new MockImporter();
        vi.mocked(invoke).mockResolvedValue('<html></html>');
        
        await importer.testFetchHtml('https://example.com');
        
        expect(invoke).toHaveBeenCalledWith('fetch_external_json', expect.objectContaining({
            headers: undefined
        }));
    });

    it('sanitizeDescription should strip HTML tags and collapse extra line breaks', () => {
        const importer = new MockImporter();

        expect(importer.testSanitizeDescription('<i>description text</i><br><br><p>More&nbsp;text</p>'))
            .toBe('description text\n\nMore text');
    });
});
