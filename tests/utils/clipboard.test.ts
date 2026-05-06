import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupCopyButton } from '../../src/clipboard';

describe('clipboard.ts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Mock navigator.clipboard
        vi.stubGlobal('navigator', {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('should copy text to clipboard and show success state', async () => {
        const btn = document.createElement('button');
        btn.innerHTML = '<span class="icon">Copy</span>';
        const text = 'test text';

        setupCopyButton(btn, text);

        btn.click();

        // Wait for async click handler to complete its first await
        await vi.waitUntil(() => btn.classList.contains('success'));

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
        expect(btn.classList.contains('success')).toBe(true);
        expect(btn.innerHTML).toContain('svg'); // Should contain the checkmark svg

        // Wait for 2 seconds timeout
        vi.advanceTimersByTime(2000);

        expect(btn.classList.contains('success')).toBe(false);
        expect(btn.innerHTML).toBe('<span class="icon">Copy</span>');
    });

    it('should handle clipboard errors', async () => {
        vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('fail'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const btn = document.createElement('button');
        setupCopyButton(btn, 'text');

        btn.click();
        await vi.runAllTimersAsync();

        expect(consoleSpy).toHaveBeenCalledWith('Failed to copy text: ', expect.any(Error));
        consoleSpy.mockRestore();
    });
});
