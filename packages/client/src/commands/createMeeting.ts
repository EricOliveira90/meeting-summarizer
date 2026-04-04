import inquirer from 'inquirer';
import chalk from 'chalk';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';
import { IMeetingService, CreateMeetingInput } from '../domain';

export interface CreateMeetingResult {
    chainToRecord: boolean;
    meetingId?: string;
}

/**
 * Truncates a string to maxLen characters, appending '…' if truncated.
 */
function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
}

/**
 * Interactive command that collects meeting details via prompts,
 * creates the meeting via MeetingService, and optionally chains to recording.
 * 
 * @returns Object with chainToRecord boolean and the created meetingId
 */
export async function createMeetingCommand(meetingService: IMeetingService): Promise<CreateMeetingResult> {
    console.log(chalk.cyan('\n📋 Create a New Meeting\n'));

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'title',
            message: 'Meeting Title:',
            validate: (input: string) => input.trim() !== '' ? true : 'Title is required',
        },
        {
            type: 'input',
            name: 'scheduledAt',
            message: 'Scheduled Date/Time (YYYY-MM-DDTHH:mm, or press Enter for now):',
            validate: (input: string) => {
                if (!input) return true; // Empty = default to now
                return !isNaN(Date.parse(input)) || 'Please enter a valid date (e.g., 2026-04-01T10:00)';
            },
        },
        {
            type: 'list',
            name: 'language',
            message: 'Transcription Language:',
            choices: Object.values(TranscriptionLanguage),
            default: TranscriptionLanguage.AUTO,
        },
        {
            type: 'list',
            name: 'template',
            message: 'AI Summary Template:',
            choices: Object.values(AIPromptTemplate),
            default: AIPromptTemplate.MEETING,
        },
        {
            type: 'input',
            name: 'attendees',
            message: 'Attendees (comma-separated, or press Enter to skip):',
        },
        {
            type: 'input',
            name: 'minSpeakers',
            message: 'Min Speakers (optional, press Enter to skip):',
            filter: (input: string) => input ? parseInt(input, 10) : undefined,
            validate: (input: string) => !input || !isNaN(parseInt(input)) || 'Please enter a number',
        },
        {
            type: 'input',
            name: 'maxSpeakers',
            message: 'Max Speakers (optional, press Enter to skip):',
            filter: (input: string) => input ? parseInt(input, 10) : undefined,
            validate: (input: string) => !input || !isNaN(parseInt(input)) || 'Please enter a number',
        },
    ]);

    // Parse attendees from comma-separated string
    const attendees = answers.attendees
        ? answers.attendees.split(',').map((a: string) => a.trim()).filter((a: string) => a.length > 0)
        : [];

    // Build the CreateMeetingInput
    const input: CreateMeetingInput = {
        title: answers.title,
        scheduledAt: answers.scheduledAt || undefined,
        language: answers.language,
        aiTemplate: answers.template,
        attendees,
        minSpeakers: answers.minSpeakers,
        maxSpeakers: answers.maxSpeakers,
    };

    const meeting = await meetingService.create(input);

    // Display confirmation
    const displayTitle = truncate(meeting.title, 50);
    console.log(chalk.green('\n✅ Meeting created successfully!\n'));
    console.log(chalk.white(`  Title:      ${displayTitle}`));
    console.log(chalk.white(`  Scheduled:  ${meeting.scheduledAt}`));
    console.log(chalk.white(`  Language:   ${meeting.language}`));
    console.log(chalk.white(`  Template:   ${meeting.aiTemplate}`));
    if (attendees.length > 0) {
        console.log(chalk.white(`  Attendees:  ${attendees.join(', ')}`));
    }
    if (meeting.minSpeakers || meeting.maxSpeakers) {
        console.log(chalk.white(`  Speakers:   ${meeting.minSpeakers ?? '?'} - ${meeting.maxSpeakers ?? '?'}`));
    }
    console.log('');

    // Ask if user wants to chain to recording
    const { chainToRecord } = await inquirer.prompt([{
        type: 'confirm',
        name: 'chainToRecord',
        message: 'Start recording now?',
        default: true,
    }]);

    return {
        chainToRecord,
        meetingId: meeting.id,
    };
}
