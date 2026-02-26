import { describe, it, expect, vi, beforeEach } from 'vitest';
import fsPromises from 'fs/promises';
import * as path from 'path';
import { NodeFileSystem } from '../../src/utils/nodeFS'; // Adjust to your actual import path

// 1. Mock the entire fs/promises module to prevent actual disk I/O during tests
vi.mock('fs/promises');

describe('NodeFileSystem', () => {
    const baseDir = '/var/app/data';
    let fileSystem: NodeFileSystem;

    beforeEach(() => {
        // Clear mock history before each test to prevent state leakage
        vi.clearAllMocks();
        fileSystem = new NodeFileSystem(baseDir);
    });

    describe('writeFile', () => {
        it('should create the directory recursively BEFORE writing the file', async () => {
            const filePath = '/var/app/data/new-folder/config.json';
            const content = '{"key": "value"}';
            const expectedDir = path.dirname(filePath);

            await fileSystem.writeFile(filePath, content);

            // Assert: Directory creation was called with correct arguments
            expect(fsPromises.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
            expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);

            // Assert: File write was called with correct arguments
            expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, content, { encoding: 'utf-8' });
            expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);

            // CRITICAL ASSERTION: Verify the execution order.
            // mkdir MUST happen before writeFile, otherwise Node throws an ENOENT error.
            const mkdirOrder = vi.mocked(fsPromises.mkdir).mock.invocationCallOrder[0];
            const writeFileOrder = vi.mocked(fsPromises.writeFile).mock.invocationCallOrder[0];
            
            expect(mkdirOrder).toBeLessThan(writeFileOrder);
        });
    });

    describe('readFile', () => {
        it('should read and return file content as a UTF-8 string', async () => {
            const filePath = '/var/app/data/file.txt';
            const mockContent = 'Hello, World!';
            
            // Setup the mock to return our fake string
            vi.mocked(fsPromises.readFile).mockResolvedValue(mockContent);

            const result = await fileSystem.readFile(filePath);

            expect(fsPromises.readFile).toHaveBeenCalledWith(filePath, { encoding: 'utf-8' });
            expect(result).toBe(mockContent);
        });
    });

    describe('joinPathsInProjectFolder', () => {
        it('should prepend the baseDir and resolve OS-specific separators correctly', () => {
            // Note: We don't mock 'path' because it is a pure function (no I/O side effects).
            // It's better to let it run natively to ensure real OS behavior.
            const result = fileSystem.joinPathsInProjectFolder('users', 'avatar.png');
            const expected = '\\var\\app\\data\\users\\avatar.png';
            
            expect(result).toBe(expected);
        });
    });

    describe('joinPaths', () => {
        it('should resolve OS-specific separators correctly', () => {
            // Note: We don't mock 'path' because it is a pure function (no I/O side effects).
            // It's better to let it run natively to ensure real OS behavior.
            const result = fileSystem.joinPaths('users', 'avatar.png');
            const expected = '\\users\\avatar.png';
            
            expect(result).toBe(expected);
        });
    });

    describe('NodeFileSystem - fileExists', () => {
        it('should return true when fsPromises.access succeeds (file exists)', async () => {
            const filePath = '/var/app/data/real-audio.mp3';
            
            // Simulate the file existing by resolving successfully
            vi.mocked(fsPromises.access).mockResolvedValueOnce(undefined);

            const result = await fileSystem.fileExists(filePath);

            expect(fsPromises.access).toHaveBeenCalledWith(filePath);
            expect(fsPromises.access).toHaveBeenCalledTimes(1);
            expect(result).toBe(true);
        });

        it('should return false when fsPromises.access throws (file is missing)', async () => {
            const filePath = '/var/app/data/phantom-audio.mp3';
            
            // Simulate the file missing by throwing an ENOENT error
            const noSuchFileError = new Error('ENOENT: no such file or directory');
            vi.mocked(fsPromises.access).mockRejectedValueOnce(noSuchFileError);

            const result = await fileSystem.fileExists(filePath);

            expect(fsPromises.access).toHaveBeenCalledWith(filePath);
            expect(fsPromises.access).toHaveBeenCalledTimes(1);
            
            // CRITICAL ASSERTION: The error was swallowed and converted to a boolean
            expect(result).toBe(false); 
        });
    });
});