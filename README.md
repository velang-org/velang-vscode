# VeLang VS Code Extension

This extension provides language support for VeLang programming language (.ve files).

## Features

- **Syntax Highlighting**: Full syntax highlighting for VeLang keywords, types, functions, strings, numbers, and comments
- **Code Snippets**: Predefined code snippets for common VeLang constructs
- **Auto-completion**: Basic auto-completion support
- **Build Integration**: Built-in commands to build and run VeLang projects
- **Error Highlighting**: Real-time error and warning highlighting from the VeLang compiler

## Installation

### From VSIX (Recommended for development)

1. Download the latest `.vsix` file from releases
2. In VS Code, go to Extensions view (Ctrl+Shift+X)
3. Click the three dots menu (...) and select "Install from VSIX..."
4. Select the downloaded `.vsix` file

### From Source

1. Clone this repository
2. Install dependencies: `npm install`
3. Compile the extension: `npm run compile`
4. Press F5 to open a new Extension Development Host window

## Configuration

You can configure the extension in VS Code settings:

- `velang.compilerPath`: Path to the VeLang compiler (default: "ve")
- `velang.buildArgs`: Additional arguments to pass to the compiler

## Commands

- `VeLang: Build Project` (Ctrl+Shift+B) - Build the current VeLang project
- `VeLang: Run Project` (F5) - Run the current VeLang project

## Supported File Extensions

- `.ve` - VeLang source files

## Language Features

### Syntax Highlighting

The extension provides syntax highlighting for:
- Keywords: `fn`, `let`, `var`, `if`, `else`, `while`, `for`, `struct`, `enum`, etc.
- Types: `i32`, `i64`, `f32`, `f64`, `bool`, `str`, `string`, etc.
- Comments: Line comments (`//`) and block comments (`/* */`)
- Strings: Double-quoted and single-quoted strings
- Numbers: Integers, floats, hex, and binary literals
- Operators: Arithmetic, comparison, logical, and assignment operators

### Code Snippets

Available snippets:
- `fn` - Function definition
- `main` - Main function
- `if` - If statement
- `ifelse` - If-else statement
- `while` - While loop
- `for` - For loop
- `struct` - Struct definition
- `enum` - Enum definition
- `match` - Match statement
- `let` - Let declaration
- `var` - Variable declaration
- `print` - Print statement
- `ret` - Return statement

## Development

### Building the Extension

```bash
npm install
npm run compile
```

### Running in Development

1. Open this project in VS Code
2. Press F5 to start debugging
3. A new Extension Development Host window will open
4. Create or open a `.ve` file to test the extension

### Packaging

To create a VSIX package:

```bash
npm install -g vsce
vsce package
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test the extension
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Changelog

### 0.1.0
- Initial release
- Basic syntax highlighting
- Code snippets
- Build and run commands
- Error highlighting
