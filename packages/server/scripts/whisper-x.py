import sys
import os
import json
import contextlib

# --- SILENCING CONTEXT MANAGER ---
# Redirects C++ and Python stdout/stderr to devnull to keep logs clean
@contextlib.contextmanager
def suppress_output():
    with open(os.devnull, "w") as devnull:
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        try:
            sys.stdout = devnull
            sys.stderr = devnull
            yield
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

# --- MAIN SCRIPT ---
# We wrap imports in the silencer because libraries like PyTorch are noisy on import
with suppress_output():
    import gc
    import argparse
    import warnings
    import torch
    
    # Nuclear Fix (PyTorch 2.6+) for 'weights_only' loading error
    _original_load = torch.load
    def permissive_load(*args, **kwargs):
        if 'weights_only' in kwargs:
            del kwargs['weights_only']
        return _original_load(*args, weights_only=False, **kwargs)
    torch.load = permissive_load

    import whisperx
    from whisperx.diarize import DiarizationPipeline
    
    warnings.filterwarnings("ignore")

def cleanup():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

def main():
    # Setup args
    parser = argparse.ArgumentParser()
    parser.add_argument('audio_path', type=str)
    parser.add_argument('--model', type=str, default="turbo")
    parser.add_argument('--batch_size', type=int, default=32)
    parser.add_argument('--hf_token', type=str, required=True)
    parser.add_argument('--language', type=str, default=None)
    parser.add_argument('--min_speakers', type=int, default=None)
    parser.add_argument('--max_speakers', type=int, default=None)
    
    # REQUIRED: We now expect Node.js to tell us exactly where to save
    parser.add_argument('--output_file', type=str, required=True, help="Path for the output txt file")
    
    args = parser.parse_args()

    final_result = None

    # --- HEAVY LIFTING (SILENCED) ---
    try:
        with suppress_output():
            # Hardware check
            if torch.cuda.is_available():
                device = "cuda"
                compute_type = "float16"
            else:
                device = "cpu"
                compute_type = "int8"

            # 1. Transcribe
            model = whisperx.load_model(args.model, device, compute_type=compute_type)
            audio = whisperx.load_audio(args.audio_path)
            result = model.transcribe(audio, batch_size=args.batch_size, language=args.language)
            
            del model
            cleanup()

            # 2. Align
            model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
            result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
            
            del model_a
            cleanup()

            # 3. Diarize
            diarize_model = DiarizationPipeline(use_auth_token=args.hf_token, device=device)
            diarize_segments = diarize_model(audio, min_speakers=args.min_speakers, max_speakers=args.max_speakers)
            final_result = whisperx.assign_word_speakers(diarize_segments, result)
            
            del diarize_model
            cleanup()

    except Exception as e:
        # Error handling: Print JSON error so Node can parse it
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    # --- FINAL OUTPUT (FILE WRITE) ---
    if final_result:
        try:
            # Write directly to the file specified by Node.js
            with open(args.output_file, "w", encoding="utf-8") as f:
                for segment in final_result["segments"]:
                    speaker = segment.get("speaker", "UNKNOWN")
                    text = segment["text"].strip()
                    f.write(f"[{speaker}] {text}\n")

            # Print success JSON metadata for Node.js
            print(json.dumps({
                "status": "success",
                "output_file": args.output_file,
                "segments_count": len(final_result["segments"])
            }))

        except IOError as e:
            print(json.dumps({"error": f"Failed to write file: {str(e)}"}))
            sys.exit(1)

if __name__ == "__main__":
    main()