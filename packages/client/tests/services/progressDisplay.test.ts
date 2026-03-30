import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressDisplay } from '../../src/services/progressDisplay';

describe('ProgressDisplay', () => {
    let mockStdout: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock process.stdout.write to capture output
        mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        // Mock process.stdout.columns for bar width calculation
        Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });
    });

    describe('single upload lifecycle', () => {
        it('should create a progress display and track upload progress', () => {
            const display = new ProgressDisplay(1);
            const onProgress = display.startUpload('meeting.mkv', 1000);

            expect(onProgress).toBeInstanceOf(Function);

            onProgress(500);
            onProgress(1000);
            display.finish();

            // Verify output was written (progress bar updates)
            expect(mockStdout).toHaveBeenCalled();
        });

        it('should not show batch counter for single uploads', () => {
            const display = new ProgressDisplay(1);
            display.startUpload('meeting.mkv', 1000);
            display.finish();

            // Check that no [1/1] batch counter appears in output
            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            expect(allOutput).not.toContain('[1/1]');
        });
    });

    describe('batch upload lifecycle', () => {
        it('should show batch counter for multiple uploads', () => {
            const display = new ProgressDisplay(3);

            const onProgress1 = display.startUpload('file1.mkv', 1000);
            onProgress1(1000);
            display.finish();

            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            expect(allOutput).toContain('[1/3]');
        });

        it('should increment batch counter across multiple uploads', () => {
            const display = new ProgressDisplay(3);

            // Upload 1
            const p1 = display.startUpload('file1.mkv', 1000);
            p1(1000);
            display.finish();

            // Upload 2
            const p2 = display.startUpload('file2.mkv', 2000);
            p2(2000);
            display.finish();

            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            expect(allOutput).toContain('[1/3]');
            expect(allOutput).toContain('[2/3]');
        });
    });

    describe('failure handling', () => {
        it('should handle upload failure gracefully', () => {
            const display = new ProgressDisplay(2);
            display.startUpload('failing.mkv', 1000);

            // Should not throw
            expect(() => display.fail('Connection refused')).not.toThrow();
        });

        it('should allow continuing to next upload after failure', () => {
            const display = new ProgressDisplay(3);

            // Upload 1 fails
            display.startUpload('file1.mkv', 1000);
            display.fail('Network error');

            // Upload 2 should still work
            const p2 = display.startUpload('file2.mkv', 2000);
            p2(2000);
            display.finish();

            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            expect(allOutput).toContain('[2/3]');
        });
    });

    describe('progress calculation', () => {
        it('should calculate percentage from bytes transferred', () => {
            const display = new ProgressDisplay(1);
            const onProgress = display.startUpload('test.mkv', 200);

            onProgress(100); // 50%

            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            expect(allOutput).toContain('50%');
        });

        it('should format bytes in human-readable format', () => {
            const display = new ProgressDisplay(1);
            const onProgress = display.startUpload('test.mkv', 1048576); // 1 MB

            onProgress(524288); // 0.5 MB

            const allOutput = mockStdout.mock.calls.map((c: any) => c[0]).join('');
            // Should contain some byte representation
            expect(allOutput).toContain('MB');
        });
    });
});
