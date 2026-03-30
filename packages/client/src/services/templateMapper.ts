import { AIPromptTemplate } from '@meeting-summarizer/shared';
import { NoteTemplate } from '../domain/models';

const templateMap: Record<string, NoteTemplate> = {
    [AIPromptTemplate.MEETING]: NoteTemplate.STD_MEETING,
    [AIPromptTemplate.TRAINING]: NoteTemplate.TRAINING,
    [AIPromptTemplate.SUMMARY]: NoteTemplate.SUMMARY,
};

/**
 * Maps an AI prompt template to the corresponding Obsidian note template.
 * No AI template maps to SELLER_MEETING — that's available only as an explicit override.
 */
export function mapAITemplateToNoteTemplate(aiTemplate: AIPromptTemplate): NoteTemplate {
    return templateMap[aiTemplate] ?? NoteTemplate.STD_MEETING;
}
