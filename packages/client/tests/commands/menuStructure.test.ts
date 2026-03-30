import { describe, it, expect } from 'vitest';
import { getMenuChoices, MenuAction } from '../../src/commands/menu';

describe('CLI Menu Structure', () => {
    it('should have menu items in the correct lifecycle order', () => {
        const choices = getMenuChoices();
        const values = choices.map(c => c.value);

        expect(values).toEqual([
            'create-meeting',
            'record',
            'jobs',
            'sync',
            'audio-setup',
            'settings',
            'exit'
        ]);
    });

    it('should have 7 menu items total', () => {
        const choices = getMenuChoices();
        expect(choices).toHaveLength(7);
    });

    it('should include Create Meeting as the first option', () => {
        const choices = getMenuChoices();
        expect(choices[0].value).toBe('create-meeting');
        expect(choices[0].name).toContain('Create Meeting');
    });

    it('should include Jobs as the third option', () => {
        const choices = getMenuChoices();
        expect(choices[2].value).toBe('jobs');
        expect(choices[2].name).toContain('Jobs');
    });

    it('should include Exit as the last option', () => {
        const choices = getMenuChoices();
        const last = choices[choices.length - 1];
        expect(last.value).toBe('exit');
    });
});
