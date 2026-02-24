import { INote, ClientJob } from '../domain/clientJob';
import { AIPromptTemplate } from '@meeting-summarizer/shared';
import { IFileSystem, ObsidianConfig } from '../domain/clientJob'; // Assuming types from previous step

export class NoteService implements INote {
    // Basic template map to fulfill the test's string-matching expectations
    private readonly templates: Record<AIPromptTemplate, string> = {
        [AIPromptTemplate.MEETING]: "# Meeting Notes\n\n## Summary\n{{SUMMARY}}\n\n## Transcript\n{{TRANSCRIPT}}",
        [AIPromptTemplate.TRAINING]: "# Training Notes\n\n## Summary\n{{SUMMARY}}\n\n## Transcript\n{{TRANSCRIPT}}",
        [AIPromptTemplate.SUMMARY]: "# Brief Summary\n\n{{SUMMARY}}"
    };

    constructor(
        private readonly fs: IFileSystem,
        private readonly config: ObsidianConfig
    ) {}

    public async saveNote(job: ClientJob, summary: string, transcript?: string): Promise<void> {
        // 1. Select the appropriate template, defaulting to MEETING if missing
        const templateType = job.options?.template ?? AIPromptTemplate.MEETING;
        let content = this.templates[templateType] || this.templates[AIPromptTemplate.MEETING];

        // 2. Inject the payloads into the placeholders
        content = content.replace('{{SUMMARY}}', summary);
        content = content.replace('{{TRANSCRIPT}}', transcript ?? '*Transcript not requested.*');

        // 3. Strip the original media extension and append .md
        const baseName = job.originalFilename.replace(/\.[^/.]+$/, "");
        const fileName = `${baseName}.md`;

        // 4. Construct the absolute path for the vault 
        // Note: In a production environment, you'd use a robust path joining method (e.g., path.join in Node)
        const fullPath = `${this.config.vaultPath}/${this.config.notesFolder}/${fileName}`;

        // 5. Delegate to the injected file system abstraction
        await this.fs.writeFile(fullPath, content);
    }
}