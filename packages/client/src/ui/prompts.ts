import inquirer from 'inquirer';
import { TranscriptionLanguage, AIPromptTemplate, UploadOptions } from '@meeting-summarizer/shared';

/**
 * Prompts the user for a meeting title.
 * Validates that the input is not empty.
 * * @returns {Promise<string>} The raw title input by the user.
 */
export async function promptForMeetingTitle(): Promise<string> {
  const { title } = await inquirer.prompt([{
    type: 'input',
    name: 'title',
    message: 'Enter Meeting Title:',
    validate: (input: string) => input.trim() !== '' ? true : 'Title is required'
  }]);

  return title;
}

/**
 * Prompts the user for AI transcription and summarization options.
 * * @param {string} filename - The name of the file being configured (for display context).
 * @returns {Promise<UploadOptions>} The selected configuration options.
 */
export async function promptForJobConfig(filename: string): Promise<UploadOptions> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: `Select language for ${filename}:`,
      choices: Object.values(TranscriptionLanguage),
      default: TranscriptionLanguage.AUTO
    },
    {
      type: 'list',
      name: 'template',
      message: `Select AI summary template:`,
      choices: Object.values(AIPromptTemplate),
      default: AIPromptTemplate.MEETING
    },
    {
      type: 'input',
      name: 'minSpeakers',
      message: 'Min Speakers (Optional, press Enter to skip):',
      filter: (input: string) => input ? parseInt(input, 10) : undefined,
      validate: (input: string) => !input || !isNaN(parseInt(input)) || 'Please enter a number'
    },
    {
      type: 'input',
      name: 'maxSpeakers',
      message: 'Max Speakers (Optional, press Enter to skip):',
      filter: (input: string) => input ? parseInt(input, 10) : undefined,
      validate: (input: string) => !input || !isNaN(parseInt(input)) || 'Please enter a number'
    }
  ]);

  return {
    language: answers.language,
    template: answers.template,
    minSpeakers: answers.minSpeakers,
    maxSpeakers: answers.maxSpeakers
  };
}