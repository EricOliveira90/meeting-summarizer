import fsPromises from 'fs/promises';
import * as path from 'path';
import { IFileManager } from '../domain/ports';

export class NodeFileSystem implements IFileManager {
    constructor(private readonly baseDir: string) {}
    
    public async readFile(filePath: string): Promise<string> {
        // Reads the file using UTF-8 encoding so it returns a string instead of a Buffer
        return await fsPromises.readFile(filePath, { encoding: 'utf-8' });
    }

    public async writeFile(filePath: string, content: string): Promise<void> {
        // Extract the directory path from the full file path
        const dir = path.dirname(filePath);
        
        // Ensure the directory exists before trying to write to it. 
        // 'recursive: true' prevents errors if the parent directories are also missing.
        await fsPromises.mkdir(dir, { recursive: true });
        
        // Write the text content to the file
        await fsPromises.writeFile(filePath, content, { encoding: 'utf-8' });
    }

    public joinPathsInProjectFolder(...parts: string[]): string {
        // Leverages Node's native path.join to handle OS-specific slashes (\ vs /) perfectly
        return path.join(this.baseDir, ...parts);
    }

    public joinPaths(...parts: string[]): string {
        // Leverages Node's native path.join to handle OS-specific slashes (\ vs /) perfectly
        return path.join(...parts);
    }

    public async fileExists(filePath: string): Promise<boolean> {
        try {
            await fsPromises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}