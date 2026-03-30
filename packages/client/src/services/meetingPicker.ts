import { IMeetingService, Meeting, MeetingStatus } from '../domain';

export interface PickerChoice {
    name: string;
    value: string;
}

export const QUICK_START_VALUE = '__quick_start__';

export class MeetingPicker {
    constructor(private meetingService: IMeetingService) {}

    /**
     * Returns a list of picker choices: all CREATED meetings + a "Quick start" option.
     * Meetings are sorted by scheduledAt (from the service's list method).
     */
    public async getPickerChoices(): Promise<PickerChoice[]> {
        const allMeetings = await this.meetingService.list();
        const createdMeetings = allMeetings.filter(m => m.status === MeetingStatus.CREATED);

        const choices: PickerChoice[] = createdMeetings.map(m => ({
            name: `${m.title} (${new Date(m.scheduledAt).toLocaleString()})`,
            value: m.id
        }));

        choices.push({
            name: '⚡ Quick start new recording',
            value: QUICK_START_VALUE
        });

        return choices;
    }

    /**
     * Handles the user's selection from the picker.
     * If quick-start, creates an ad-hoc meeting with the given title.
     * Otherwise, retrieves the selected meeting.
     * In both cases, transitions the meeting to RECORDING.
     */
    public async selectMeeting(selectedValue: string, quickStartTitle?: string): Promise<Meeting | undefined> {
        let meeting: Meeting | undefined;

        if (selectedValue === QUICK_START_VALUE) {
            if (!quickStartTitle) throw new Error('Title is required for quick start');
            meeting = await this.meetingService.create({ title: quickStartTitle });
        } else {
            meeting = await this.meetingService.getById(selectedValue);
        }

        if (meeting) {
            await this.meetingService.updateStatus(meeting.id, MeetingStatus.RECORDING);
        }

        return meeting;
    }

    /**
     * Marks a meeting as RECORDED when recording stops.
     */
    public async markRecordingStopped(meetingId: string): Promise<void> {
        await this.meetingService.updateStatus(meetingId, MeetingStatus.RECORDED);
    }
}
