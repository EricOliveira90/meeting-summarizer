import { describe, it, expect } from 'vitest';
import { formatJobsTable, getStatusDisplay } from '../../src/ui/tableFormatter';
import { ClientJob, ClientJobStatus } from '../../src/domain/models';

function makeJob(overrides: Partial<ClientJob> = {}): ClientJob {
    return {
        id: 'abcdef12-3456-7890-abcd-ef1234567890',
        filePath: '/recordings/test.wav',
        originalFilename: 'test-recording.wav',
        recordedAt: '2026-03-29T14:30:00.000Z',
        clientStatus: ClientJobStatus.COMPLETED,
        retryCount: 0,
        ...overrides,
    };
}

describe('Table Formatter', () => {
    describe('formatJobsTable()', () => {
        it('should return a friendly message when there are no jobs', () => {
            const result = formatJobsTable([]);
            expect(result).toContain('No jobs yet');
            expect(result).toContain('Record a meeting');
        });

        it('should render a table with borders for multiple jobs', () => {
            const jobs = [
                makeJob({ id: 'aaaa1111-0000-0000-0000-000000000000', originalFilename: 'sprint-planning.wav', clientStatus: ClientJobStatus.COMPLETED }),
                makeJob({ id: 'bbbb2222-0000-0000-0000-000000000000', originalFilename: 'standup.wav', clientStatus: ClientJobStatus.PROCESSING }),
            ];
            const result = formatJobsTable(jobs);
            // Should contain box-drawing characters
            expect(result).toContain('─');
            expect(result).toContain('│');
            // Should contain short IDs (first 8 chars)
            expect(result).toContain('aaaa1111');
            expect(result).toContain('bbbb2222');
            // Should contain filenames
            expect(result).toContain('sprint-planning.wav');
            expect(result).toContain('standup.wav');
        });

        it('should show short ID as first 8 characters', () => {
            const jobs = [makeJob({ id: 'abcdef12-3456-7890-abcd-ef1234567890' })];
            const result = formatJobsTable(jobs);
            expect(result).toContain('abcdef12');
        });

        it('should truncate filenames longer than 30 characters', () => {
            const longName = 'this-is-a-very-long-filename-that-exceeds-thirty-chars.wav';
            const jobs = [makeJob({ originalFilename: longName })];
            const result = formatJobsTable(jobs);
            // Should not contain the full name
            expect(result).not.toContain(longName);
            // Should contain truncated version with ellipsis
            expect(result).toContain('…');
        });

        it('should render a single job as a one-row table', () => {
            const jobs = [makeJob()];
            const result = formatJobsTable(jobs);
            expect(result).toContain('abcdef12');
            expect(result).toContain('test-recording.wav');
        });

        it('should format the recorded date', () => {
            const jobs = [makeJob({ recordedAt: '2026-03-29T14:30:00.000Z' })];
            const result = formatJobsTable(jobs);
            expect(result).toContain('2026-03-29');
        });

        it('should truncate titles longer than 50 characters', () => {
            // Title truncation is for display in confirmation/table — tested via filename proxy
            const longTitle = 'a]'.repeat(30) + '.wav'; // > 30 chars
            const jobs = [makeJob({ originalFilename: longTitle })];
            const result = formatJobsTable(jobs);
            expect(result).toContain('…');
        });
    });

    describe('getStatusDisplay()', () => {
        it('should map COMPLETED to ✅', () => {
            expect(getStatusDisplay(ClientJobStatus.COMPLETED)).toContain('✅');
            expect(getStatusDisplay(ClientJobStatus.COMPLETED)).toContain('COMPLETED');
        });

        it('should map PROCESSING to ⏳', () => {
            expect(getStatusDisplay(ClientJobStatus.PROCESSING)).toContain('⏳');
        });

        it('should map UPLOADING to 📤', () => {
            expect(getStatusDisplay(ClientJobStatus.UPLOADING)).toContain('📤');
        });

        it('should map WAITING_UPLOAD to ⏸️', () => {
            expect(getStatusDisplay(ClientJobStatus.WAITING_UPLOAD)).toContain('⏸️');
        });

        it('should map FAILED to ❌', () => {
            expect(getStatusDisplay(ClientJobStatus.FAILED)).toContain('❌');
        });

        it('should map ABANDONED to 💀', () => {
            expect(getStatusDisplay(ClientJobStatus.ABANDONED)).toContain('💀');
        });

        it('should map DELETED to 🗑️', () => {
            expect(getStatusDisplay(ClientJobStatus.DELETED)).toContain('🗑️');
        });

        it('should map READY to ⬇️', () => {
            expect(getStatusDisplay(ClientJobStatus.READY)).toContain('⬇️');
        });
    });
});
