import chalk from 'chalk';
import { ClientJob, ClientJobStatus } from '../domain/models';

const STATUS_MAP: Record<ClientJobStatus, string> = {
    [ClientJobStatus.COMPLETED]: '✅ COMPLETED',
    [ClientJobStatus.PROCESSING]: '⏳ PROCESSING',
    [ClientJobStatus.UPLOADING]: '📤 UPLOADING',
    [ClientJobStatus.WAITING_UPLOAD]: '⏸️  WAITING',
    [ClientJobStatus.FAILED]: '❌ FAILED',
    [ClientJobStatus.ABANDONED]: '💀 ABANDONED',
    [ClientJobStatus.DELETED]: '🗑️  DELETED',
    [ClientJobStatus.READY]: '⬇️  READY',
};

/**
 * Returns the emoji + label display string for a given job status.
 */
export function getStatusDisplay(status: ClientJobStatus): string {
    return STATUS_MAP[status] || status;
}

/**
 * Truncates a string to maxLen characters, appending '…' if truncated.
 */
function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
}

/**
 * Pads a string to a fixed width (right-padded with spaces).
 */
function pad(str: string, width: number): string {
    if (str.length >= width) return str;
    return str + ' '.repeat(width - str.length);
}

/**
 * Formats the recorded date from an ISO string to YYYY-MM-DD.
 */
function formatDate(isoString: string): string {
    return isoString.split('T')[0];
}

/**
 * Formats an array of ClientJob objects into a chalk-styled table with box-drawing borders.
 * Returns a friendly message if the array is empty.
 */
export function formatJobsTable(jobs: ClientJob[]): string {
    if (jobs.length === 0) {
        return chalk.yellow('\n  📭 No jobs yet! Record a meeting and run Sync & Summarize to see jobs here.\n');
    }

    const ID_WIDTH = 10;
    const FILENAME_WIDTH = 32;
    const STATUS_WIDTH = 16;
    const DATE_WIDTH = 12;

    const header = [
        pad('ID', ID_WIDTH),
        pad('Filename', FILENAME_WIDTH),
        pad('Status', STATUS_WIDTH),
        pad('Recorded', DATE_WIDTH),
    ];

    const separator = [
        '─'.repeat(ID_WIDTH),
        '─'.repeat(FILENAME_WIDTH),
        '─'.repeat(STATUS_WIDTH),
        '─'.repeat(DATE_WIDTH),
    ];

    const rows = jobs.map(job => {
        const shortId = job.id.slice(0, 8);
        const filename = truncate(job.originalFilename, 30);
        const status = getStatusDisplay(job.clientStatus);
        const date = formatDate(job.recordedAt);

        return [
            pad(shortId, ID_WIDTH),
            pad(filename, FILENAME_WIDTH),
            pad(status, STATUS_WIDTH),
            pad(date, DATE_WIDTH),
        ];
    });

    const lines: string[] = [];

    // Top border
    lines.push(chalk.gray('  ┌' + separator.join('┬') + '┐'));

    // Header row
    lines.push(chalk.gray('  │') + header.map(h => chalk.bold.white(h)).join(chalk.gray('│')) + chalk.gray('│'));

    // Header separator
    lines.push(chalk.gray('  ├' + separator.join('┼') + '┤'));

    // Data rows
    for (const row of rows) {
        lines.push(chalk.gray('  │') + row.join(chalk.gray('│')) + chalk.gray('│'));
    }

    // Bottom border
    lines.push(chalk.gray('  └' + separator.join('┴') + '┘'));

    return '\n' + lines.join('\n') + '\n';
}
