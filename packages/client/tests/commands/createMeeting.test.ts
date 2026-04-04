import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';
import { IMeetingService, Meeting, MeetingStatus, CreateMeetingInput } from '../../src/domain';

// Mock inquirer before importing the module under test
vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

import inquirer from 'inquirer';
import { createMeetingCommand } from '../../src/commands/createMeeting';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
    return {
        id: 'test-meeting-id-1234',
        title: 'Sprint Planning',
        scheduledAt: '2026-03-29T14:30:00.000Z',
        language: TranscriptionLanguage.AUTO,
        aiTemplate: AIPromptTemplate.MEETING,
        attendees: [],
        status: MeetingStatus.CREATED,
        createdAt: '2026-03-29T14:00:00.000Z',
        ...overrides,
    };
}

function makeMockMeetingService(): IMeetingService {
    return {
        create: vi.fn().mockResolvedValue(makeMeeting()),
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(makeMeeting()),
        updateStatus: vi.fn().mockResolvedValue(undefined),
        linkToJob: vi.fn().mockResolvedValue(undefined),
    };
}

describe('Create Meeting Command', () => {
    let mockService: IMeetingService;
    const mockPrompt = vi.mocked(inquirer.prompt);

    beforeEach(() => {
        vi.clearAllMocks();
        mockService = makeMockMeetingService();
    });

    it('should create a meeting with all user-provided details and return chainToRecord=true', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Sprint Planning',
            scheduledAt: '2026-04-01T10:00',
            language: TranscriptionLanguage.ENGLISH,
            template: AIPromptTemplate.MEETING,
            attendees: 'Alice, Bob, Charlie',
            minSpeakers: 2,
            maxSpeakers: 5,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: true });

        const result = await createMeetingCommand(mockService);

        expect(mockService.create).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Sprint Planning',
            language: TranscriptionLanguage.ENGLISH,
            aiTemplate: AIPromptTemplate.MEETING,
            attendees: ['Alice', 'Bob', 'Charlie'],
            minSpeakers: 2,
            maxSpeakers: 5,
        }));
        expect(result.chainToRecord).toBe(true);
        expect(result.meetingId).toBe('test-meeting-id-1234');
    });

    it('should return chainToRecord=false when user declines recording', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Standup',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.SUMMARY,
            attendees: '',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        const result = await createMeetingCommand(mockService);

        expect(result.chainToRecord).toBe(false);
        expect(result.meetingId).toBe('test-meeting-id-1234');
    });

    it('should default scheduledAt to now when user skips date input', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Quick Meeting',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        await createMeetingCommand(mockService);

        const createCall = vi.mocked(mockService.create).mock.calls[0][0];
        // scheduledAt should be undefined (service defaults to now)
        expect(createCall.scheduledAt).toBeUndefined();
    });

    it('should parse attendees from comma-separated string', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Team Sync',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '  Alice ,  Bob  , Charlie  ',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        await createMeetingCommand(mockService);

        const createCall = vi.mocked(mockService.create).mock.calls[0][0];
        expect(createCall.attendees).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should handle empty attendees as empty array', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Solo Meeting',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        await createMeetingCommand(mockService);

        const createCall = vi.mocked(mockService.create).mock.calls[0][0];
        expect(createCall.attendees).toEqual([]);
    });

    it('should pass scheduledAt when user provides a valid date', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Future Meeting',
            scheduledAt: '2026-04-15T09:00',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        await createMeetingCommand(mockService);

        const createCall = vi.mocked(mockService.create).mock.calls[0][0];
        expect(createCall.scheduledAt).toBe('2026-04-15T09:00');
    });

    it('should return the created meeting ID for chaining', async () => {
        const customMeeting = makeMeeting({ id: 'custom-uuid-5678' });
        vi.mocked(mockService.create).mockResolvedValueOnce(customMeeting);

        mockPrompt.mockResolvedValueOnce({
            title: 'Important Meeting',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '',
            minSpeakers: undefined,
            maxSpeakers: undefined,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: true });

        const result = await createMeetingCommand(mockService);

        expect(result.meetingId).toBe('custom-uuid-5678');
        expect(result.chainToRecord).toBe(true);
    });

    it('should pass minSpeakers and maxSpeakers when provided', async () => {
        mockPrompt.mockResolvedValueOnce({
            title: 'Panel Discussion',
            scheduledAt: '',
            language: TranscriptionLanguage.AUTO,
            template: AIPromptTemplate.MEETING,
            attendees: '',
            minSpeakers: 3,
            maxSpeakers: 8,
        });
        mockPrompt.mockResolvedValueOnce({ chainToRecord: false });

        await createMeetingCommand(mockService);

        const createCall = vi.mocked(mockService.create).mock.calls[0][0];
        expect(createCall.minSpeakers).toBe(3);
        expect(createCall.maxSpeakers).toBe(8);
    });
});
