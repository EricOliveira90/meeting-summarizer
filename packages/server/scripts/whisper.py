import sys
import json
import whisper
import warnings
import torch
import argparse

# Suppress warnings (like "FP16 is not supported on CPU") to keep stdout clean for JSON
warnings.filterwarnings("ignore")

def main():
    # 1. Setup Argument Parser
    parser = argparse.ArgumentParser(description='Whisper Transcription Script')
    parser.add_argument('audio_path', type=str, help='Path to the audio file')
    parser.add_argument('--language', type=str, default=None, help='Language code (e.g., en, pt, es)')
    
    args = parser.parse_args()

    # 2. Select Device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    try:
        # 3. Load Model
        # 'base' is a good balance. Use 'small' or 'medium' if you have a GPU and want higher accuracy.
        model = whisper.load_model("base", device=device)

        # 4. Transcribe
        # pass the language if provided, otherwise None (Whisper will auto-detect)
        # fp16=False is generally safer for CPU/compatibility
        result = model.transcribe(
            args.audio_path, 
            language=args.language,
            fp16=False 
        )
        
        # 5. Output JSON
        output = {
            "text": str(result["text"]).strip(),
            "language": result["language"],
            "device_used": device,
            "detected_language": result["language"] # explicit confirmation of what was used
        }
        
        print(json.dumps(output))

    except Exception as e:
        # Catch errors and print as JSON so Node.js can handle it gracefully
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()