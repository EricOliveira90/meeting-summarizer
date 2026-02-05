import sys
import json
import whisper
import warnings
import torch

# Suppress warnings (like "FP16 is not supported on CPU") to keep stdout clean for JSON
warnings.filterwarnings("ignore")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file provided"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    
    # Select device: Use CUDA (NVIDIA GPU) if available, else CPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    try:
        # Load Model
        # 'base' is a good balance of speed/accuracy. 
        # Options: tiny, base, small, medium, large
        model = whisper.load_model("base", device=device)

        # Transcribe
        # fp16=False is safer for CPU inference to avoid warnings/errors
        result = model.transcribe(audio_path, fp16=False)
        
        # Output strictly JSON to stdout so Node.js can parse it
        output = {
            "text": result["text"].strip(),
            "language": result["language"],
            "device_used": device
        }
        
        print(json.dumps(output))

    except Exception as e:
        # Catch errors and print as JSON
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()