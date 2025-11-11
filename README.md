# LLT Assistant - VSCode Test Generation Plugin

A VSCode extension that automatically generates pytest unit tests for Python functions using AI. Simply describe what you want to test, and let the AI generate comprehensive, production-ready test code.

## Overview

LLT Assistant helps developers write better tests faster by:
- Analyzing your Python functions automatically
- Generating comprehensive pytest test cases
- Supporting both OpenAI and Claude AI models
- Providing an intuitive, dialog-based interface

## Features

### Phase 1 (Current) - Basic Infrastructure
- ✅ Right-click context menu integration for Python files
- ✅ Function code analysis and extraction
- ✅ API integration with OpenAI and Claude
- ✅ Configuration management for API keys and settings
- ✅ User-friendly dialog interfaces
- ✅ Error handling and retry mechanisms

### Coming Soon (Phase 2)
- 🔜 Two-stage AI agent architecture for intelligent test generation
- 🔜 Scenario confirmation workflow
- 🔜 Automatic pytest code generation
- 🔜 Test file creation and organization

## Requirements

- VSCode version 1.105.0 or higher
- Node.js 18 or higher (for development)
- An API key from either:
  - OpenAI (gpt-4, gpt-3.5-turbo, etc.)
  - Anthropic Claude (claude-3-opus, claude-3-sonnet, etc.)

## Installation

### For Development

1. Clone the repository:
```bash
git clone <repository-url>
cd LLT-Assistant-VScode
```

2. Install dependencies using pnpm:
```bash
pnpm install
```

3. Compile the extension:
```bash
pnpm run compile
```

4. Open in VSCode:
```bash
code .
```

5. Press `F5` to launch the extension in a new Extension Development Host window

### For Users (Once Published)

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "LLT Assistant"
4. Click Install

## Configuration

### Step 1: Configure API Provider

Open VSCode Settings (File > Preferences > Settings) and search for "LLT Assistant":

1. **API Provider**: Choose between `openai` or `claude`
   - Default: `openai`

2. **Model Name**: Specify the model to use
   - For OpenAI: `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`
   - For Claude: `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`
   - Default: `gpt-4`

3. **Temperature**: Control randomness (0-2)
   - Default: `0.3` (more focused and deterministic)
   - Higher values = more creative, Lower values = more focused

4. **Max Tokens**: Maximum tokens for responses
   - Default: `2000`

### Step 2: Add Your API Key

You can add your API key in two ways:

**Option A: Via Settings (Recommended)**
1. Open Settings > Extensions > LLT Assistant
2. Enter your API key in the "API Key" field
3. The key will be saved securely in your VSCode settings

**Option B: On First Use**
- The extension will prompt you to enter your API key when you first use it
- The key will be saved for future use

### Getting API Keys

**OpenAI:**
1. Go to https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy and save the key

**Claude (Anthropic):**
1. Go to https://console.anthropic.com/
2. Sign in or create an account
3. Navigate to API Keys section
4. Generate a new API key
5. Copy and save the key

## Usage

### Generate Tests for a Python Function

1. Open a Python file in VSCode
2. Place your cursor inside a function or select the function code
3. Right-click to open the context menu
4. Select "Generate Tests"
5. Enter a description of what you want to test (e.g., "Test the login function with valid and invalid credentials")
6. The extension will analyze your code and generate tests

### Example

Given this Python function:

```python
def calculate_total(items: list[dict], tax_rate: float = 0.1) -> float:
    """Calculate total price including tax"""
    if not items:
        raise ValueError("Items list cannot be empty")

    subtotal = sum(item['price'] * item['quantity'] for item in items)
    tax = subtotal * tax_rate
    return subtotal + tax
```

The extension will:
1. Extract function information (name, parameters, return type)
2. Analyze the code structure (branches, exceptions, etc.)
3. Prompt you for test description
4. Connect to the AI API
5. Generate comprehensive pytest tests

## Extension Settings

This extension contributes the following settings:

* `llt-assistant.apiProvider`: Choose API provider (`openai` or `claude`)
* `llt-assistant.apiKey`: Your API key for the selected provider
* `llt-assistant.modelName`: AI model to use for generation
* `llt-assistant.temperature`: Temperature for LLM generation (0-2)
* `llt-assistant.maxTokens`: Maximum tokens for LLM response

## Project Structure

```
.
├── src/
│   ├── api/              # API client and configuration
│   │   ├── client.ts     # LLM API client (OpenAI/Claude)
│   │   ├── config.ts     # Configuration manager
│   │   ├── errorHandler.ts  # Error handling
│   │   └── index.ts      # API module exports
│   ├── ui/               # User interface components
│   │   ├── dialogs.ts    # Dialog helpers
│   │   └── index.ts      # UI module exports
│   ├── utils/            # Utility functions
│   │   ├── codeAnalysis.ts  # Python code analyzer
│   │   └── index.ts      # Utils module exports
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts      # Type definitions
│   ├── extension.ts      # Main extension entry point
│   └── test/             # Test files
├── dist/                 # Compiled output
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Development

### Available Scripts

```bash
# Install dependencies
pnpm install

# Compile TypeScript
pnpm run compile

# Watch mode (auto-recompile on changes)
pnpm run watch

# Run type checking
pnpm run check-types

# Run linter
pnpm run lint

# Run tests
pnpm run test

# Package for production
pnpm run package
```

### Development Workflow

1. Make changes to source files in `src/`
2. Run `pnpm run watch` for automatic compilation
3. Press `F5` in VSCode to launch Extension Development Host
4. Test your changes
5. Run `pnpm run lint` before committing

## Troubleshooting

### Common Issues

**"No active editor found"**
- Make sure you have a Python file open and in focus

**"Could not find a Python function"**
- Place your cursor inside a function definition
- Or select the entire function code including the `def` line

**"API key is required"**
- Add your API key in settings or when prompted
- Make sure the key is valid and has sufficient credits

**"Authentication failed"**
- Check that your API key is correct
- Verify the key hasn't expired
- Ensure you have credits available in your API account

**"Rate limit exceeded"**
- Wait a few moments and try again
- Consider upgrading your API plan for higher limits

## Architecture Overview

### Phase 1: Foundation (Complete)
- Extension scaffold with command registration
- Configuration management
- API client with OpenAI and Claude support
- Error handling and retry logic
- UI components for user interaction
- Code analysis utilities

### Phase 2: AI Agent Implementation (Coming Soon)
- **Stage 1 Agent**: Scenario identification and confirmation
- **Stage 2 Agent**: Test code generation
- Prompt engineering for optimal results
- Test file management and organization

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

[Your License Here]

## Release Notes

### 0.0.1 (Phase 1)

Initial release with basic infrastructure:
- Right-click menu integration
- API client setup (OpenAI & Claude)
- Configuration management
- Code analysis utilities
- UI dialog components
- Error handling and retry mechanisms

**Next**: Phase 2 will implement the full AI-powered test generation workflow.

---

## Support

If you encounter any issues or have questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Search existing issues on GitHub
3. Create a new issue with detailed information

**Enjoy automated test generation!** 🚀
