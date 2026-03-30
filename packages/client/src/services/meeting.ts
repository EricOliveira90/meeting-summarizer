import { randomUUID } from 'crypto';
import { IMeetingService, Meeting, MeetingStatus, CreateMeetingInput } from '../domain';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';
import { LowDB } from './db';

export class MeetingService implements IMeetingService {
    constructor(private db: LowDB) {}

    public async create(input: CreateMeetingInput): Promise<Meeting> {
        if (!input.title || !input.title.trim()) {
            throw new Error('Title is required');
        }

        const meeting: Meeting = {
            id: randomUUID(),
            title: input.title.trim(),
            scheduledAt: input.scheduledAt || new Date().toISOString(),
            language: input.language || TranscriptionLanguage.AUTO,
            aiTemplate: input.aiTemplate || AIPromptTemplate.MEETING,
            attendees: input.attendees || [],
            minSpeakers: input.minSpeakers,
            maxSpeakers: input.maxSpeakers,
            status: MeetingStatus.CREATED,
            createdAt: new Date().toISOString()
        };

        await this.db.addMeeting(meeting);
        return meeting;
    }

    public async list(): Promise<Meeting[]> {
        return this.db.getAllMeetings();
    }

    public async getById(id: string): Promise<Meeting | undefined> {
        return this.db.getMeetingById(id);
    }

    public async update(id: string, fields: Partial<CreateMeetingInput>): Promise<Meeting> {
        return this.db.updateMeeting(id, fields);
    }

    public async updateStatus(id: string, status: MeetingStatus): Promise<void> {
        await this.db.updateMeetingStatus(id, status);
    }

    public async linkToJob(meetingId: string, jobId: string): Promise<void> {
        await this.db.updateMeeting(meetingId, { jobId, status: MeetingStatus.LINKED });
    }
}
