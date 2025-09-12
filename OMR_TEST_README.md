# OMR Testing Documentation

This directory contains the OMR (Optical Mark Recognition) testing files for evaluating Gemini's ability to detect filled circles in answer sheets.

## Files
- `test-omr-gemini.js` - Main test script for OMR detection
- `omr.png` - Sample OMR answer sheet image for testing

## Running the Test
```bash
cd backend
node test-omr-gemini.js
```

## What the Test Does
1. **General OMR Detection** - Overall analysis of the OMR sheet
2. **Circle Detection** - Specific detection of filled/shaded circles
3. **Question-Answer Mapping** - Maps detected answers to question numbers
4. **Prompt Variations** - Tests different prompting strategies

## Expected Output
The test will show how accurately Gemini can:
- Detect filled circles vs empty circles
- Map circles to correct question numbers and options
- Provide confidence levels for detections
- Handle different image qualities and marking styles
