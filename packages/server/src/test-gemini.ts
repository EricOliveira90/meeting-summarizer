import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

// 1. Initialize the client
// Ensure GEMINI_API_KEY is set in your environment variables
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ Error: GEMINI_API_KEY is missing from environment variables.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function main() {
  try {
    // 2. Define the model and prompt
    // 'gemini-2.0-flash' is currently the most efficient model for simple tasks
    const modelId = "gemini-2.5-flash";
    const prompt = "Explain the difference between interface and type in TypeScript in one sentence.";

    console.log(`🤖 Sending prompt to ${modelId}...`);

    // 3. Generate content
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
    });

    // 4. Output the result
    // The new SDK exposes text directly as a property, not a function
    if (response.text) {
        console.log("\n--- Response ---");
        console.log(response.text);
        console.log("----------------");
    } else {
        console.log("No text response received.");
    }

  } catch (error) {
    console.error("❌ API Request Failed:", error);
  }
}

main();