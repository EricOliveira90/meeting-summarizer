import { NoteTemplate } from '@meeting-summarizer/shared';
import { INote, ClientJob } from '../domain/clientJob';
import { IFileManager, ObsidianConfig } from '../domain'; // Assuming types from previous step
import { noteTemplatesList } from '../templates/noteTemplates';

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
        content = content.replace('{{DATE}}', job.createdAt.split('T')[0]);
        content = content.replace('{{TRANSCRIPT}}', transcript ?? '');

        // 3. Strip the original media extension and append .md
        const baseName = job.originalFilename.replace(/\.[^/.]+$/, "");
        const fileName = `${baseName}.md`;

        // 4. Construct the absolute path for the vault 
        // Note: In a production environment, you'd use a robust path joining method (e.g., path.join in Node)
        const fullPath = this.fs.joinPaths(this.config.vaultPath, this.config.notesFolder, fileName);

        // 5. Delegate to the injected file system abstraction
        await this.fs.writeFile(fullPath, content);
    }
}