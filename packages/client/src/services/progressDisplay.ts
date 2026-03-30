/**
 * ProgressDisplay - Visual progress feedback during file uploads.
 * Provides per-file progress bars and batch counters for multi-job syncs.
 */
export class ProgressDisplay {
    private totalUploads: number;
    private currentIndex: number = 0;
    private currentFilename: string = '';
    private currentTotalBytes: number = 0;

    constructor(totalUploads: number) {
        this.totalUploads = totalUploads;
    }

    /**
     * Starts tracking a new upload.
     * @returns An onProgress callback that accepts bytesTransferred.
     */
    public startUpload(filename: string, totalBytes: number): (bytesTransferred: number) => void {
        this.currentIndex++;
        this.currentFilename = filename;
        this.currentTotalBytes = totalBytes;

        this.render(0);

        return (bytesTransferred: number) => {
            this.render(bytesTransferred);
        };
    }

    /**
     * Marks the current upload as finished successfully.
     */
    public finish(): void {
        this.render(this.currentTotalBytes);
        process.stdout.write('\n');
    }

    /**
     * Marks the current upload as failed.
     */
    public fail(errorMessage: string): void {
        const prefix = this.totalUploads > 1
            ? `[${this.currentIndex}/${this.totalUploads}] `
            : '';
        process.stdout.write(`\r${prefix}❌ ${this.currentFilename}: ${errorMessage}\n`);
    }

    private render(bytesTransferred: number): void {
        const percent = this.currentTotalBytes > 0
            ? Math.round((bytesTransferred * 100) / this.currentTotalBytes)
            : 0;

        const prefix = this.totalUploads > 1
            ? `[${this.currentIndex}/${this.totalUploads}] `
            : '';

        const barWidth = 20;
        const filled = Math.round((percent / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);

        const bytesStr = this.formatBytes(bytesTransferred);
        const totalStr = this.formatBytes(this.currentTotalBytes);

        process.stdout.write(`\r${prefix}${this.currentFilename} ${bar} ${percent}% ${bytesStr}/${totalStr}`);
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
        return `${(bytes / 1073741824).toFixed(1)} GB`;
    }
}
