import { AIPromptTemplate } from '@meeting-summarizer/shared';

export const SUMMARY_PROMPTS: Record<AIPromptTemplate, string> = {
  [AIPromptTemplate.MEETING]: [
    'Create structured meeting minutes from the Transcript.',
    'Include decisions, action items with owners when stated, and open questions.',
  ].join('\n'),
  [AIPromptTemplate.TRAINING]: [
    'Create a structured training Summary from the Transcript.',
    'Include key concepts, examples, and questions with their answers.',
  ].join('\n'),
  [AIPromptTemplate.SUMMARY]: [
    'Create a concise Summary of the Transcript.',
    'Include the main points and important conclusions.',
  ].join('\n'),
};
