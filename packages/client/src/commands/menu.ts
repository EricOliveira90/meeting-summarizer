/**
 * CLI Menu definition - reflects the meeting lifecycle order.
 * Extracted as a pure function for testability.
 */

export type MenuAction = 'create-meeting' | 'record' | 'jobs' | 'sync' | 'audio-setup' | 'settings' | 'exit';

export interface MenuChoice {
    name: string;
    value: MenuAction;
}

/**
 * Returns the main menu choices in the correct meeting lifecycle order:
 * 1. Create Meeting
 * 2. Start Recording
 * 3. Jobs
 * 4. Sync & Summarize
 * 5. Audio Setup
 * 6. Settings
 * 7. Exit
 */
export function getMenuChoices(): MenuChoice[] {
    return [
        { name: 'Create Meeting 📋', value: 'create-meeting' },
        { name: 'Start Recording 🔴', value: 'record' },
        { name: 'Jobs 📊', value: 'jobs' },
        { name: 'Sync & Summarize 🧠', value: 'sync' },
        { name: 'Audio Setup 🎙️', value: 'audio-setup' },
        { name: 'Settings ⚙️', value: 'settings' },
        { name: 'Exit 🚪', value: 'exit' }
    ];
}
