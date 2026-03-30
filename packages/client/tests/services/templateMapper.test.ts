import { describe, it, expect } from 'vitest';
import { mapAITemplateToNoteTemplate } from '../../src/services/templateMapper';
import { AIPromptTemplate } from '@meeting-summarizer/shared';
import { NoteTemplate } from '../../src/domain/models';

describe('TemplateMapper', () => {
    it('should map "meeting" AI template to STD_MEETING note template', () => {
        expect(mapAITemplateToNoteTemplate(AIPromptTemplate.MEETING)).toBe(NoteTemplate.STD_MEETING);
    });

    it('should map "training" AI template to TRAINING note template', () => {
        expect(mapAITemplateToNoteTemplate(AIPromptTemplate.TRAINING)).toBe(NoteTemplate.TRAINING);
    });

    it('should map "summary" AI template to SUMMARY note template', () => {
        expect(mapAITemplateToNoteTemplate(AIPromptTemplate.SUMMARY)).toBe(NoteTemplate.SUMMARY);
    });

    it('should default to STD_MEETING for unknown AI templates', () => {
        expect(mapAITemplateToNoteTemplate('unknown' as AIPromptTemplate)).toBe(NoteTemplate.STD_MEETING);
    });
});
