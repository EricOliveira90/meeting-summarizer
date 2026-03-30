import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeetingPicker } from '../../src/services/meetingPicker';
import { MeetingStatus } from '../../src/domain/models';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';

describe('MeetingPicker', () => {
    let mockMeetingService: any;
    let picker: MeetingPicker;

    const fakeMeetings = [
        {
            id: 'meeting-1',
            title: 'Sprint Planning',
            scheduledAt: '2026-04-01T10:00:00Z',
            language: TranscriptionLanguage.ENGLISH,
            aiTemplate: AIPromptTemplate.MEETING,
            attendees: ['Alice', 'Bob'],
            minSpeakers: 2,
            maxSpeakers: 4,
            status: MeetingStatus.CREATED,
            createdAt: '2026-03-30T10:00:00Z'
        },
        {
            id: 'meeting-2',
            title: 'Training Session',
            scheduledAt: '2026-04-02T14:00:00Z',
            language: TranscriptionLanguage.AUTO,
            aiTemplate: AIPromptTemplate.TRAINING,
            attendees: [],
            status: MeetingStatus.CREATED,
            createdAt: '2026-03-30T11:00:00Z'
        },
        {
            id: 'meeting-3',
            title: 'Already Recording',
            scheduledAt: '2026-04-01T09:00:00Z',
            language: TranscriptionLanguage.AUTO,
            aiTemplate: AIPromptTemplate.MEETING,
            attendees: [],
            status: MeetingStatus.RECORDING,
            createdAt: '2026-03-30T12:00:00Z'
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();

        mockMeetingService = {
            create: vi.fn(),
            list: vi.fn().mockResolvedValue(fakeMeetings),
            getById: vi.fn(),
            update: vi.fn(),
            updateStatus: vi.fn(),
            linkToJob: vi.fn()
        };

        picker = new MeetingPicker(mockMeetingService);
    });

    describe('getPickerChoices()', () => {
        it('should return only CREATED meetings plus a quick-start option', async () => {
            const choices = await picker.getPickerChoices();

            // Should have 2 CREATED meetings + 1 quick-start option
            expect(choices).toHaveLength(3);

            // Quick start should be last
            expect(choices[choices.length - 1].value).toBe('__quick_start__');
            expect(choices[choices.length - 1].name).toContain('Quick start');

            // CREATED meetings should be present, RECORDING should not
            const meetingIds = choices.map(c => c.value);
            expect(meetingIds).toContain('meeting-1');
            expect(meetingIds).toContain('meeting-2');
            expect(meetingIds).not.toContain('meeting-3');
        });

        it('should return only quick-start when no CREATED meetings exist', async () => {
            mockMeetingService.list.mockResolvedValue([
                { ...fakeMeetings[2] } // Only RECORDING meeting
            ]);

            const choices = await picker.getPickerChoices();

            expect(choices).toHaveLength(1);
            expect(choices[0].value).toBe('__quick_start__');
        });
    });

    describe('selectMeeting()', () => {
        it('should return the selected meeting and transition it to RECORDING', async () => {
            mockMeetingService.getById.mockResolvedValue(fakeMeetings[0]);

            const result = await picker.selectMeeting('meeting-1');

            expect(result).toBeDefined();
            expect(result!.id).toBe('meeting-1');
            expect(mockMeetingService.updateStatus).toHaveBeenCalledWith('meeting-1', MeetingStatus.RECORDING);
        });

        it('should create an ad-hoc meeting for quick-start selection', async () => {
            const adHocMeeting = {
                id: 'adhoc-1',
                title: 'Quick Meeting',
                status: MeetingStatus.RECORDING,
                language: TranscriptionLanguage.AUTO,
                aiTemplate: AIPromptTemplate.MEETING,
                attendees: [],
                scheduledAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };
            mockMeetingService.create.mockResolvedValue(adHocMeeting);

            const result = await picker.selectMeeting('__quick_start__', 'Quick Meeting');

            expect(mockMeetingService.create).toHaveBeenCalledWith({ title: 'Quick Meeting' });
            expect(mockMeetingService.updateStatus).toHaveBeenCalledWith('adhoc-1', MeetingStatus.RECORDING);
            expect(result!.id).toBe('adhoc-1');
        });
    });

    describe('markRecordingStopped()', () => {
        it('should transition meeting to RECORDED status', async () => {
            await picker.markRecordingStopped('meeting-1');

            expect(mockMeetingService.updateStatus).toHaveBeenCalledWith('meeting-1', MeetingStatus.RECORDED);
        });
    });
});
