import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MeetingService } from '../../src/services/meeting';
import { LowDB } from '../../src/services/db';
import { MeetingStatus } from '../../src/domain/models';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';

describe('MeetingService', () => {
    let mockFileSystem: any;
    let db: LowDB;
    let meetingService: MeetingService;
    let testDir: string;

    beforeEach(() => {
        mockFileSystem = {
            fileExists: vi.fn().mockResolvedValue(true)
        };

        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-service-test-'));
        const testDbPath = path.join(testDir, 'meeting-db.json');
        db = new LowDB(mockFileSystem, testDbPath);
        meetingService = new MeetingService(db);
    });

    afterEach(async () => {
        await db.getAllMeetings();
        vi.restoreAllMocks();
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe('create()', () => {
        it('should create a meeting with required title and sensible defaults', async () => {
            const meeting = await meetingService.create({ title: 'Sprint Planning' });

            expect(meeting.id).toBeDefined();
            expect(meeting.title).toBe('Sprint Planning');
            expect(meeting.status).toBe(MeetingStatus.CREATED);
            expect(meeting.aiTemplate).toBe(AIPromptTemplate.MEETING);
            expect(meeting.language).toBe(TranscriptionLanguage.AUTO);
            expect(meeting.scheduledAt).toBeDefined();
            expect(meeting.createdAt).toBeDefined();
            expect(meeting.attendees).toEqual([]);
        });

        it('should create a meeting with all optional fields specified', async () => {
            const meeting = await meetingService.create({
                title: 'Training Session',
                scheduledAt: '2026-04-01T14:00:00Z',
                language: TranscriptionLanguage.PORTUGUESE,
                aiTemplate: AIPromptTemplate.TRAINING,
                attendees: ['Alice', 'Bob'],
                minSpeakers: 2,
                maxSpeakers: 5
            });

            expect(meeting.title).toBe('Training Session');
            expect(meeting.scheduledAt).toBe('2026-04-01T14:00:00Z');
            expect(meeting.language).toBe(TranscriptionLanguage.PORTUGUESE);
            expect(meeting.aiTemplate).toBe(AIPromptTemplate.TRAINING);
            expect(meeting.attendees).toEqual(['Alice', 'Bob']);
            expect(meeting.minSpeakers).toBe(2);
            expect(meeting.maxSpeakers).toBe(5);
        });

        it('should reject a meeting with an empty title', async () => {
            await expect(meetingService.create({ title: '' }))
                .rejects.toThrow('Title is required');
        });

        it('should reject a meeting with a whitespace-only title', async () => {
            await expect(meetingService.create({ title: '   ' }))
                .rejects.toThrow('Title is required');
        });
    });

    describe('list()', () => {
        it('should return meetings sorted by scheduledAt ascending', async () => {
            await meetingService.create({ title: 'Later', scheduledAt: '2026-04-02T10:00:00Z' });
            await meetingService.create({ title: 'Earlier', scheduledAt: '2026-04-01T10:00:00Z' });
            await meetingService.create({ title: 'Middle', scheduledAt: '2026-04-01T15:00:00Z' });

            const meetings = await meetingService.list();

            expect(meetings).toHaveLength(3);
            expect(meetings[0].title).toBe('Earlier');
            expect(meetings[1].title).toBe('Middle');
            expect(meetings[2].title).toBe('Later');
        });

        it('should return an empty array when no meetings exist', async () => {
            const meetings = await meetingService.list();
            expect(meetings).toEqual([]);
        });
    });

    describe('getById()', () => {
        it('should retrieve a meeting by its ID', async () => {
            const created = await meetingService.create({ title: 'Standup' });
            const found = await meetingService.getById(created.id);

            expect(found).toBeDefined();
            expect(found!.title).toBe('Standup');
        });

        it('should return undefined for a non-existent ID', async () => {
            const found = await meetingService.getById('non-existent-id');
            expect(found).toBeUndefined();
        });
    });

    describe('update()', () => {
        it('should update meeting fields', async () => {
            const created = await meetingService.create({ title: 'Old Title' });
            const updated = await meetingService.update(created.id, { title: 'New Title', attendees: ['Charlie'] });

            expect(updated.title).toBe('New Title');
            expect(updated.attendees).toEqual(['Charlie']);
        });
    });

    describe('updateStatus()', () => {
        it('should transition meeting status correctly through the lifecycle', async () => {
            const meeting = await meetingService.create({ title: 'Lifecycle Test' });
            expect(meeting.status).toBe(MeetingStatus.CREATED);

            await meetingService.updateStatus(meeting.id, MeetingStatus.RECORDING);
            let updated = await meetingService.getById(meeting.id);
            expect(updated!.status).toBe(MeetingStatus.RECORDING);

            await meetingService.updateStatus(meeting.id, MeetingStatus.RECORDED);
            updated = await meetingService.getById(meeting.id);
            expect(updated!.status).toBe(MeetingStatus.RECORDED);

            await meetingService.updateStatus(meeting.id, MeetingStatus.LINKED);
            updated = await meetingService.getById(meeting.id);
            expect(updated!.status).toBe(MeetingStatus.LINKED);
        });
    });

    describe('linkToJob()', () => {
        it('should set the jobId on the meeting and transition to LINKED', async () => {
            const meeting = await meetingService.create({ title: 'Link Test' });
            await meetingService.updateStatus(meeting.id, MeetingStatus.RECORDED);

            await meetingService.linkToJob(meeting.id, 'job-abc-123');

            const linked = await meetingService.getById(meeting.id);
            expect(linked!.jobId).toBe('job-abc-123');
            expect(linked!.status).toBe(MeetingStatus.LINKED);
        });
    });
});
