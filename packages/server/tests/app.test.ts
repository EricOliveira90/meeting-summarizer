import { describe, it, expect, beforeAll, vi } from 'vitest';
import FormData from 'form-data'; 

// --- FIXED MOCK ---
vi.mock('@google/genai', () => {
  return {
    // 1. Define GoogleGenAI as a real class or constructor function
    GoogleGenAI: class {
      constructor(apiKey: any) {
        // You can log here to verify the mock is working if needed
      }

      // 2. Mock the methods strictly
      getGenerativeModel() {
        return {
          generateContent: vi.fn().mockResolvedValue({ 
            response: { text: () => 'Mock Summary' } 
          })
        };
      }
    }
  };
});
// ------------------

// Import app AFTER the mock
import { buildServer } from '../src/index';

describe('Server API', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  it('GET / should return online status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ 
      status: 'online', 
      service: 'Meeting Summarizer Server' 
    });
  });

  it('POST /upload should return 400 when file is missing', async () => {
    const form = new FormData();
    // Add fields but NO file
    form.append('language', 'en'); 
    
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: form.getHeaders(),
      payload: form
    });

    expect(response.statusCode).toBe(400); 
    expect(response.json()).toEqual({ error: 'No file uploaded' });
  });
});