import path from 'path';
import { audioExtractionService } from 'services/audio-extractor';

async function runExtraction() {
  try {
    // 1. Define paths relative to this script
    // Replace 'video.mkv' with your actual file name
    const inputFileName = '2026-02-06_1on1_Nic.mkv'; 
    const inputPath = path.join(__dirname, inputFileName);
    
    // We will save the wav in the same folder, or you can create a subfolder like 'output'
    const outputDir = __dirname; 

    console.log(`🚀 Starting test for: ${inputFileName}`);

    // 2. Call the service
    const result = await audioExtractionService.convertToWav(inputPath, outputDir);

    // 3. Log results
    console.log('--- Extraction Complete ---');
    console.log(`Output File: ${result.audioPath}`);
    if (result.duration) {
      console.log(`Duration: ${result.duration} seconds`);
    }

  } catch (error) {
    console.error('Extraction failed:', error);
  }
}

// Execute the function
runExtraction();