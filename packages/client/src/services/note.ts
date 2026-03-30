import { INote, IFileManager } from '../domain/ports';
import { ObsidianConfig } from '../domain';
import { noteTemplatesList } from '../templates/noteTemplates';
import { ClientJob, NoteTemplate } from '../domain/models';

export interface RegenerateResult {
    templateUsed: NoteTemplate;
}

export class NoteService implements INote {
    constructor(
        private readonly fs: IFileManager,
        private readonly config: ObsidianConfig
    ) {}

    public async saveNote(job: ClientJob, summary: string, transcript?: string): Promise<void> {
        // 1. Select the appropriate template, defaulting to MEETING if missing
        const templateType = job.noteTemplate ?? NoteTemplate.STD_MEETING;
        let content = noteTemplatesList[templateType] || noteTemplatesList[NoteTemplate.STD_MEETING];

        // 2. Inject the payloads into the placeholders
        content = content.replace('{{SUMMARY}}', summary);
        content = content.replace('{{DATE}}', job.recordedAt.split('T')[0]);
        content = content.replace('{{TRANSCRIPT}}', transcript ?? '');

        // 3. Strip the original media extension and append .md
        const baseName = job.originalFilename.replace(/\.[^/.]+$/, "");
        const fileName = `${baseName}.md`;

        // 4. Construct the absolute path for the vault 
        const fullPath = this.fs.joinPaths(this.config.vaultPath, this.config.notesFolder, fileName);

        // 5. Delegate to the injected file system abstraction
        await this.fs.writeFile(fullPath, content);
    }

    /**
     * Re-renders an Obsidian note for a completed job using a (possibly different) template.
     * Reads summary and transcript from local files, then overwrites the note in the vault.
     */
    public async regenerateNote(
        job: ClientJob,
        template: NoteTemplate,
        fileManager: IFileManager
    ): Promise<RegenerateResult> {
        const baseName = job.originalFilename.replace(/\.[^/.]+$/, '');

        // 1. Read summary from local file
        const summaryPath = fileManager.joinPathsInProjectFolder('summaries', `${baseName}_summary.txt`);
        const summary = await fileManager.readFile(summaryPath);

        // 2. Read transcript if it exists
        let transcript = '';
        const transcriptPath = fileManager.joinPathsInProjectFolder('transcriptions', `${baseName}_transcription.txt`);
        if (await fileManager.fileExists(transcriptPath)) {
            transcript = await fileManager.readFile(transcriptPath);
        }

        // 3. Render with the selected template
        let content = noteTemplatesList[template] || noteTemplatesList[NoteTemplate.STD_MEETING];
        content = content.replace('{{SUMMARY}}', summary);
        content = content.replace('{{DATE}}', job.recordedAt.split('T')[0]);
        content = content.replace('{{TRANSCRIPT}}', transcript);

        // 4. Write to vault (overwrites existing note)
        const fileName = `${baseName}.md`;
        const fullPath = this.fs.joinPaths(this.config.vaultPath, this.config.notesFolder, fileName);
        await this.fs.writeFile(fullPath, content);

        return { templateUsed: template };
    }
}
