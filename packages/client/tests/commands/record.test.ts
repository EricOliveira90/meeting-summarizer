import { describe, it, expect } from 'vitest';
import { buildRecordingFilename, sanitizeTitle } from '../../src/commands/record';

describe('Record Command — File Naming', () => {
    describe('sanitizeTitle()', () => {
        it('should replace special characters with underscores', () => {
            expect(sanitizeTitle('My Meeting: Q1 Review!')).toBe('My_Meeting_Q1_Review_');
        });

        it('should collapse consecutive underscores', () => {
            expect(sanitizeTitle('Hello   World---Test')).toBe('Hello_World_Test');
        });

        it('should handle already clean titles', () => {
            expect(sanitizeTitle('Sprint_Planning')).toBe('Sprint_Planning');
        });

        it('should handle empty string', () => {
            expect(sanitizeTitle('')).toBe('');
        });

        it('should preserve alphanumeric characters', () => {
            expect(sanitizeTitle('Meeting2026')).toBe('Meeting2026');
        });
    });

    describe('buildRecordingFilename()', () => {
        it('should build filename with title and timestamp', () => {
            const date = new Date(2026, 2, 29, 14, 30); // March 29, 2026 14:30
            const result = buildRecordingFilename('Sprint Planning', date);
            expect(result).toBe('2026-03-29_14-30_Sprint_Planning.wav');
        });

        it('should use "recording" as placeholder when no title provided', () => {
            const date = new Date(2026, 2, 29, 9, 5); // March 29, 2026 09:05
            const result = buildRecordingFilename(undefined, date);
            expect(result).toBe('2026-03-29_09-05_recording.wav');
        });

        it('should use "recording" as placeholder when empty title provided', () => {
            const date = new Date(2026, 2, 29, 9, 5);
            const result = buildRecordingFilename('', date);
            expect(result).toBe('2026-03-29_09-05_recording.wav');
        });

        it('should sanitize special characters in the title', () => {
            const date = new Date(2026, 0, 15, 10, 0); // Jan 15, 2026 10:00
            const result = buildRecordingFilename('Q1: Budget Review!', date);
            expect(result).toBe('2026-01-15_10-00_Q1_Budget_Review_.wav');
        });

        it('should pad single-digit months, days, hours, and minutes', () => {
            const date = new Date(2026, 0, 5, 8, 3); // Jan 5, 2026 08:03
            const result = buildRecordingFilename('Standup', date);
            expect(result).toBe('2026-01-05_08-03_Standup.wav');
        });
    });

    describe('buildRecordingFilename() — post-recording rename', () => {
        it('should preserve original timestamp when renaming with new title', () => {
            // Original recording was at 14:30, user provides title later
            const originalDate = new Date(2026, 2, 29, 14, 30);
            const originalFilename = buildRecordingFilename(undefined, originalDate);
            expect(originalFilename).toBe('2026-03-29_14-30_recording.wav');

            // After recording, user provides a title — we rebuild with same timestamp
            const renamedFilename = buildRecordingFilename('Sprint Planning', originalDate);
            expect(renamedFilename).toBe('2026-03-29_14-30_Sprint_Planning.wav');

            // Both share the same timestamp prefix
            expect(originalFilename.substring(0, 16)).toBe(renamedFilename.substring(0, 16));
        });
    });
});
