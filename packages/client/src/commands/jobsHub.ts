import inquirer from 'inquirer';
import chalk from 'chalk';
import { IFileManager } from '../domain/ports';
import { ClientJobStatus, NoteTemplate } from '../domain/models';
import { JobManager } from '../services/jobManager';
import { NoteService } from '../services/note';
import { formatJobsTable, getStatusDisplay } from '../ui/tableFormatter';

const BACK_VALUE = '__back__';

type JobAction = 'view-summary' | 'view-transcript' | 'retry' | 'cancel' | 'regenerate' | 'back';

/**
 * Builds the list of available actions based on the job's current status.
 * Only shows actions that are valid for the given status.
 */
function getActionsForStatus(status: ClientJobStatus, hasSummary: boolean, hasTranscript: boolean): Array<{ name: string; value: JobAction }> {
    const actions: Array<{ name: string; value: JobAction }> = [];

    if (status === ClientJobStatus.COMPLETED) {
        if (hasSummary) {
            actions.push({ name: '📄 View Summary', value: 'view-summary' });
        }
        if (hasTranscript) {
            actions.push({ name: '📝 View Transcript', value: 'view-transcript' });
        }
        actions.push({ name: '🔄 Regenerate Obsidian Note', value: 'regenerate' });
    }

    if (status === ClientJobStatus.FAILED || status === ClientJobStatus.ABANDONED) {
        actions.push({ name: '🔁 Retry Job', value: 'retry' });
    }

    if (status === ClientJobStatus.WAITING_UPLOAD) {
        actions.push({ name: '🗑️  Cancel Job', value: 'cancel' });
    }

    actions.push({ name: '← Back to list', value: 'back' });

    return actions;
}

/**
 * Interactive Jobs Hub command.
 * Displays all jobs in a formatted table, lets the user select a job to see details,
 * and provides context-aware actions (view summary/transcript, retry, cancel, regenerate note).
 * 
 * Implements a sub-loop: list → detail → back to list, until user chooses "Back to menu".
 */
export async function jobsHubCommand(
    jobManager: JobManager,
    noteService: NoteService,
    fileManager: IFileManager
): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        // Fetch and display jobs
        const jobs = await jobManager.listJobs();
        console.log(formatJobsTable(jobs));

        // Build choices: each job + back option
        const choices = jobs.map(job => ({
            name: `${job.id.slice(0, 8)} │ ${job.originalFilename.slice(0, 30)} │ ${getStatusDisplay(job.clientStatus)}`,
            value: job.id,
        }));
        choices.push({ name: '← Back to main menu', value: BACK_VALUE });

        const { selectedJobId } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedJobId',
            message: 'Select a job to view details:',
            choices,
        }]);

        if (selectedJobId === BACK_VALUE) {
            return; // Exit the hub loop
        }

        // Fetch job details
        const details = await jobManager.getJobDetails(selectedJobId);

        if (!details) {
            console.log(chalk.yellow('\n⚠️  Job not found. It may have been deleted.\n'));
            continue; // Back to list
        }

        const { job, summary, transcript } = details;

        // Display job detail header
        console.log(chalk.cyan(`\n📋 Job Details: ${job.id.slice(0, 8)}`));
        console.log(chalk.white(`  Filename:  ${job.originalFilename}`));
        console.log(chalk.white(`  Status:    ${getStatusDisplay(job.clientStatus)}`));
        console.log(chalk.white(`  Recorded:  ${job.recordedAt.split('T')[0]}`));
        if (job.error) {
            console.log(chalk.red(`  Error:     ${job.error}`));
        }
        console.log('');

        // Show status-aware actions
        const actions = getActionsForStatus(job.clientStatus, !!summary, !!transcript);

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: actions,
        }]);

        // Execute the selected action
        switch (action as JobAction) {
            case 'view-summary':
                if (summary) {
                    console.log(chalk.cyan('\n📄 Summary:\n'));
                    console.log(summary);
                    console.log('');
                } else {
                    console.log(chalk.yellow('\n⚠️  No summary available.\n'));
                }
                break;

            case 'view-transcript':
                if (transcript) {
                    console.log(chalk.cyan('\n📝 Transcript:\n'));
                    console.log(transcript);
                    console.log('');
                } else {
                    console.log(chalk.yellow('\n⚠️  No transcript available.\n'));
                }
                break;

            case 'retry':
                try {
                    await jobManager.retryJob(job.id);
                    console.log(chalk.green(`\n✅ Job retried successfully. It will be uploaded on next sync.\n`));
                } catch (error) {
                    console.log(chalk.red(`\n❌ Failed to retry job: ${error instanceof Error ? error.message : error}\n`));
                }
                break;

            case 'cancel':
                try {
                    await jobManager.cancelJob(job.id);
                    console.log(chalk.green(`\n🗑️  Job cancelled.\n`));
                } catch (error) {
                    console.log(chalk.red(`\n❌ Failed to cancel job: ${error instanceof Error ? error.message : error}\n`));
                }
                break;

            case 'regenerate': {
                const { template } = await inquirer.prompt([{
                    type: 'list',
                    name: 'template',
                    message: 'Select note template:',
                    choices: Object.values(NoteTemplate),
                }]);

                try {
                    const result = await noteService.regenerateNote(job, template, fileManager);
                    console.log(chalk.green(`\n📝 Note regenerated with template: ${result.templateUsed}\n`));
                } catch (error) {
                    console.log(chalk.red(`\n❌ Failed to regenerate note: ${error instanceof Error ? error.message : error}\n`));
                }
                break;
            }

            case 'back':
                // Continue the while loop to show the list again
                break;
        }
    }
}
