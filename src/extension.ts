import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    console.log('VeLang extension is now active!');

    let buildCommand = vscode.commands.registerCommand('velang.build', () => {
        buildVeLangProject();
    });
    let runCommand = vscode.commands.registerCommand('velang.run', () => {
        runVeLangProject();
    });
    let runMainCommand = vscode.commands.registerCommand('velang.runMain', (uri: vscode.Uri) => {
        runVeLangFile(uri.fsPath);
    });

    const symbolProvider = vscode.languages.registerDocumentSymbolProvider(
        { scheme: 'file', language: 'velang' },
        new VeLangSymbolProvider()
    );

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'velang' },
        new VeLangCompletionProvider(),
        ' ', '.', '('
    );

    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        { scheme: 'file', language: 'velang' },
        new VeLangCodeLensProvider()
    );

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('velang');
    context.subscriptions.push(diagnosticCollection);

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.ve');
    fileWatcher.onDidChange(uri => updateDiagnostics(uri, diagnosticCollection));
    fileWatcher.onDidCreate(uri => updateDiagnostics(uri, diagnosticCollection));

    context.subscriptions.push(buildCommand, runCommand, runMainCommand, symbolProvider, completionProvider, codeLensProvider, fileWatcher);

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(vscode.window.activeTextEditor.document.uri, diagnosticCollection);
    }
}

function buildVeLangProject() {
    const config = vscode.workspace.getConfiguration('velang');
    const compilerPath = config.get<string>('compilerPath', 've');
    const buildArgs = config.get<string[]>('buildArgs', []);
    
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const terminal = vscode.window.createTerminal('VeLang Build');
    
    const buildCommand = `${compilerPath} build ${buildArgs.join(' ')}`;
    terminal.sendText(`cd "${workspaceRoot}"`);
    terminal.sendText(buildCommand);
    terminal.show();
}

function runVeLangFile(filePath: string) {
    const config = vscode.workspace.getConfiguration('velang');
    const compilerPath = config.get<string>('compilerPath', 've');
    
    const terminal = vscode.window.createTerminal('VeLang Run Main');
    const runCommand = `${compilerPath} run "${filePath}"`;
    
    terminal.sendText(runCommand);
    terminal.show();
    vscode.window.showInformationMessage(`Running main function in ${path.basename(filePath)}`);
}

function runVeLangProject() {
    const config = vscode.workspace.getConfiguration('velang');
    const compilerPath = config.get<string>('compilerPath', 've');
    
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const terminal = vscode.window.createTerminal('VeLang Run');
    
    const runCommand = `${compilerPath} run`;
    terminal.sendText(`cd "${workspaceRoot}"`);
    terminal.sendText(runCommand);
    terminal.show();
}

function updateDiagnostics(uri: vscode.Uri, collection: vscode.DiagnosticCollection) {
    if (path.extname(uri.fsPath) !== '.ve') {
        return;
    }

    const config = vscode.workspace.getConfiguration('velang');
    const compilerPath = config.get<string>('compilerPath', 've');
    
    exec(`${compilerPath} check "${uri.fsPath}"`, (error, stdout, stderr) => {
        const diagnostics: vscode.Diagnostic[] = [];
        
        if (stderr) {
            const errors = parseCompilerOutput(stderr);
            for (const error of errors) {
                const range = new vscode.Range(
                    new vscode.Position(error.line - 1, error.column - 1),
                    new vscode.Position(error.line - 1, error.column + error.length - 1)
                );
                
                const diagnostic = new vscode.Diagnostic(
                    range,
                    error.message,
                    error.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
                );
                
                diagnostics.push(diagnostic);
            }
        }
        
        collection.set(uri, diagnostics);
    });
}

interface CompilerError {
    line: number;
    column: number;
    length: number;
    message: string;
    severity: 'error' | 'warning';
}

function parseCompilerOutput(output: string): CompilerError[] {
    const errors: CompilerError[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
        const match = line.match(/(\d+):(\d+):\s*(error|warning):\s*(.+)/);
        if (match) {
            errors.push({
                line: parseInt(match[1]),
                column: parseInt(match[2]),
                length: 1,
                message: match[4],
                severity: match[3] as 'error' | 'warning'
            });
        }
    }
    return errors;
}

class VeLangCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            const mainMatch = line.match(/^fn\s+main\s*\(/);
            if (mainMatch) {
                const range = new vscode.Range(i, 0, i, line.length);
                const runCodeLens = new vscode.CodeLens(range, {
                    title: "▶ Run",
                    command: "velang.runMain",
                    arguments: [document.uri]
                });
                
                codeLenses.push(runCodeLens);
            }
        }

        return codeLenses;
    }
}

class VeLangCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
        const line = document.lineAt(position).text;
        const textBeforeCursor = line.substring(0, position.character);
        const completionItems: vscode.CompletionItem[] = [];

        if (textBeforeCursor.includes('import') && (textBeforeCursor.includes('"') || textBeforeCursor.endsWith(' '))) {
            const importCompletions = this.getImportCompletions(textBeforeCursor, document, line, position);
            return importCompletions;
        }

        if (textBeforeCursor.trim().endsWith('import') || textBeforeCursor.match(/import\s*$/)) {
            const importCompletion = new vscode.CompletionItem('import', vscode.CompletionItemKind.Keyword);
            importCompletion.insertText = 'import';
            importCompletion.detail = 'Import statement';
            importCompletion.documentation = 'Import a module';
            importCompletion.sortText = '0import';
            
            return [importCompletion];
        }
        
        if (textBeforeCursor.endsWith('fn ') || textBeforeCursor.match(/fn\s+$/)) {
            const mainCompletion = new vscode.CompletionItem('main', vscode.CompletionItemKind.Function);
            mainCompletion.insertText = new vscode.SnippetString('main() {\n\t$0\n}');
            mainCompletion.detail = 'Main function';
            mainCompletion.documentation = 'Creates the main entry point function';
            mainCompletion.sortText = '0main';
            
            return [mainCompletion];
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (wordRange) {
            const currentWord = document.getText(wordRange);
            if ('import'.startsWith(currentWord) && currentWord !== 'import') {
                const importCompletion = new vscode.CompletionItem('import', vscode.CompletionItemKind.Keyword);
                importCompletion.insertText = 'import';
                importCompletion.detail = 'Import statement';
                importCompletion.documentation = 'Import a module';
                importCompletion.sortText = '0import';
                completionItems.push(importCompletion);
            }
            
            if ('fn'.startsWith(currentWord) && currentWord !== 'fn') {
                const fnCompletion = new vscode.CompletionItem('fn', vscode.CompletionItemKind.Keyword);
                fnCompletion.insertText = new vscode.SnippetString('fn ${1:function_name}(${2:parameters}) {\n\t$0\n}');
                fnCompletion.detail = 'Function declaration';
                fnCompletion.documentation = 'Create a new function';
                fnCompletion.sortText = '0fn';
                completionItems.push(fnCompletion);
            }

            const functions = this.getFunctionsInDocument(document);
            
            const importedFunctions = this.getImportedFunctions(document);
            
            for (const func of [...functions, ...importedFunctions]) {
                if (func.name.startsWith(currentWord) && func.name !== currentWord) {
                    const completion = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
                    completion.detail = `Function (${func.parameters})`;
                    completion.documentation = `Call ${func.name} function`;
                    completion.insertText = new vscode.SnippetString(`${func.name}(${func.snippetParameters})`);
                    completion.sortText = `1${func.name}`;
                    completionItems.push(completion);
                }
            }
            
            const variables = this.getVariablesInScope(document, position);
            for (const variable of variables) {
                if (variable.name.startsWith(currentWord) && variable.name !== currentWord) {
                    const completion = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
                    const varKeyword = variable.scope.includes('FFI') ? 'var' : 'let';
                    completion.detail = `${varKeyword} ${variable.name}: ${variable.type}`;
                    completion.documentation = `Variable of type ${variable.type}`;
                    completion.insertText = variable.name;
                    completion.sortText = `2${variable.name}`;
                    completionItems.push(completion);
                }
            }
        } else {
            const importCompletion = new vscode.CompletionItem('import', vscode.CompletionItemKind.Keyword);
            importCompletion.insertText = new vscode.SnippetString("import")
            importCompletion.detail = 'Import statement';
            importCompletion.documentation = 'Import a module';
            importCompletion.sortText = '0import';
            completionItems.push(importCompletion);
            
            const fnCompletion = new vscode.CompletionItem('fn', vscode.CompletionItemKind.Keyword);
            fnCompletion.insertText = new vscode.SnippetString('fn ${1:function_name}(${2:parameters}) {\n\t$0\n}');
            fnCompletion.detail = 'Function declaration';
            fnCompletion.documentation = 'Create a new function';
            fnCompletion.sortText = '0fn';
            completionItems.push(fnCompletion);
            
            const functions = this.getFunctionsInDocument(document);
            
            const importedFunctions = this.getImportedFunctions(document);
            
            for (const func of [...functions, ...importedFunctions]) {
                const completion = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
                completion.detail = `Function (${func.parameters})`;
                completion.documentation = `Call ${func.name} function`;
                completion.insertText = new vscode.SnippetString(`${func.name}(${func.snippetParameters})`);
                completion.sortText = `1${func.name}`;
                completionItems.push(completion);
            }
            
            const variables = this.getVariablesInScope(document, position);
            for (const variable of variables) {
                const completion = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
                const varKeyword = variable.scope.includes('FFI') ? 'var' : 'let';
                completion.detail = `${varKeyword} ${variable.name}: ${variable.type}`;
                completion.documentation = `Variable of type ${variable.type}`;
                completion.insertText = variable.name;
                completion.sortText = `2${variable.name}`;
                completionItems.push(completion);
            }
        }
        
        const keywords = [
            'fn', 'let', 'var', 'if', 'else', 'return', 'safe', 'rawptr', 'defer', 'as', 'while', 'for', 'import', 'from', 'export', 'struct', 'enum', 'match', 'true', 'false', 'foreign', 'in'
        ];
        for (const kw of keywords) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            item.insertText = kw;
            item.detail = 'Keyword';
            item.sortText = '0' + kw;
            completionItems.push(item);
        }

        return completionItems;
    }
    
    private getFunctionsInDocument(document: vscode.TextDocument): Array<{name: string, parameters: string, snippetParameters: string}> {
        const functions: Array<{name: string, parameters: string, snippetParameters: string}> = [];
        const text = document.getText();
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            const functionMatch = line.match(/^fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
            if (functionMatch) {
                const functionName = functionMatch[1];
                const parametersStr = functionMatch[2].trim();
                
                let snippetParams = '';
                if (parametersStr) {
                    const params = parametersStr.split(',').map(p => p.trim());
                    const snippetParts: string[] = [];
                    
                    for (let j = 0; j < params.length; j++) {
                        const param = params[j];
                        const paramMatch = param.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                        if (paramMatch) {
                            snippetParts.push(`\${${j + 1}:${paramMatch[1]}}`);
                        } else {
                            snippetParts.push(`\${${j + 1}:param${j + 1}}`);
                        }
                    }
                    snippetParams = snippetParts.join(', ');
                } else {
                    snippetParams = '$0';
                }
                
                functions.push({
                    name: functionName,
                    parameters: parametersStr || 'no parameters',
                    snippetParameters: snippetParams
                });
            }
        }

        return functions;
    }
    
    private getImportedFunctions(document: vscode.TextDocument): Array<{name: string, parameters: string, snippetParameters: string}> {
        const functions: Array<{name: string, parameters: string, snippetParameters: string}> = [];
        const text = document.getText();
        const lines = text.split('\n');
        
        const imports: string[] = [];
        for (const line of lines) {
            const importMatch = line.trim().match(/^import\s+"([^"]+)";?$/);
            if (importMatch) {
                imports.push(importMatch[1]);
            }
        }
        
        for (const importPath of imports) {
            if (importPath.startsWith('std/')) {
                const moduleFunctions = this.getStandardLibraryFunctions(importPath);
                functions.push(...moduleFunctions);
            }
        }
        
        return functions;
    }

private getStandardLibraryFunctions(modulePath: string): Array<{name: string, parameters: string, snippetParameters: string}> {
    const functions: Array<{name: string, parameters: string, snippetParameters: string}> = [];
    
    try {
        const velangHome = path.join(os.homedir(), '.velang');
        const moduleFileName = modulePath.replace('std/', '') + '.ve';
        const stdLibPath = path.join(velangHome, 'lib', 'std', 'src', moduleFileName);
        
        if (fs.existsSync(stdLibPath)) {
            const content = fs.readFileSync(stdLibPath, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                const functionMatch = line.trim().match(/^(?:export\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
                if (functionMatch) {
                    const functionName = functionMatch[1];
                    const parametersStr = functionMatch[2].trim();
                    
                    let snippetParams = '';
                    if (parametersStr) {
                        const params = parametersStr.split(',').map(p => p.trim());
                        const snippetParts: string[] = [];
                        
                        for (let j = 0; j < params.length; j++) {
                            const param = params[j];
                            const paramMatch = param.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
                            if (paramMatch) {
                                snippetParts.push(`\${${j + 1}:${paramMatch[1]}}`);
                            } else {
                                snippetParts.push(`\${${j + 1}:param${j + 1}}`);
                            }
                        }
                        snippetParams = snippetParts.join(', ');
                    } else {
                        snippetParams = '$0';
                    }
                    
                    functions.push({
                        name: functionName,
                        parameters: parametersStr || 'no parameters',
                        snippetParameters: snippetParams
                    });
                }
            }
        }
    } catch (error) {
        console.error(`Error reading standard library module ${modulePath}:`, error);
    }
    
    return functions;
}

private getImportCompletions(textBeforeCursor: string, document: vscode.TextDocument, line: string, position: vscode.Position): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];
        const insideQuotes = textBeforeCursor.includes('"') && !textBeforeCursor.endsWith('"');
        if (insideQuotes) {
            const quoteIndex = textBeforeCursor.lastIndexOf('"');
            const currentPath = textBeforeCursor.substring(quoteIndex + 1);
            const availableModules = this.getAvailableStdModules();
            for (const module of availableModules) {
                if (module.name.startsWith(currentPath)) {
                    const fullImport = `import \"${module.name}\";`;
                    const replaceRange = new vscode.Range(position.line, 0, position.line, line.length);
                    const completion = new vscode.CompletionItem(module.name, vscode.CompletionItemKind.Module);
                    completion.detail = 'Library module';
                    completion.documentation = module.description;
                    completion.insertText = fullImport;
                    completion.range = replaceRange;
                    completion.sortText = `0${module.name}`;
                    completions.push(completion);
                }
            }
        } else {
            const availableModules = this.getAvailableStdModules();
            
            for (const module of availableModules) {
                const completion = new vscode.CompletionItem(`"${module.name}"`, vscode.CompletionItemKind.Module);
                completion.detail = 'Standard library module';
                completion.documentation = module.description;
                completion.insertText = new vscode.SnippetString(`"${module.name}"`);
                completion.sortText = `0${module.name}`;
                completions.push(completion);
            }
        }

        return completions;
    }
    
    private getVariablesInScope(document: vscode.TextDocument, position: vscode.Position): Array<{name: string, type: string, scope: string, value?: string}> {
        const variables: Array<{name: string, type: string, scope: string, value?: string}> = [];
        const text = document.getText();
        const lines = text.split('\n');
        const currentLine = position.line;
        
        let currentFunction: string | null = null;
        let functionStartLine = -1;
        
        for (let i = currentLine; i >= 0; i--) {
            const line = lines[i].trim();
            const functionMatch = line.match(/^fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
            if (functionMatch) {
                currentFunction = functionMatch[1];
                functionStartLine = i;
                
                const parametersStr = functionMatch[2].trim();
                if (parametersStr) {
                    const params = parametersStr.split(',').map(p => p.trim());
                    
                    for (const param of params) {
                        const paramMatch = param.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
                        if (paramMatch) {
                            variables.push({
                                name: paramMatch[1],
                                type: paramMatch[2],
                                scope: `parameter of ${currentFunction}`
                            });
                        }
                    }
                }
                break;
            }
        }
        
        if (currentFunction && functionStartLine >= 0) {
            let functionEndLine = lines.length - 1;
            let braceCount = 0;
            let foundOpen = false;
            
            for (let i = functionStartLine; i < lines.length; i++) {
                const line = lines[i];
                for (let j = 0; j < line.length; j++) {
                    if (line[j] === '{') {
                        braceCount++;
                        foundOpen = true;
                    } else if (line[j] === '}') {
                        braceCount--;
                        if (foundOpen && braceCount === 0) {
                            functionEndLine = i;
                            break;
                        }
                    }
                }
                if (foundOpen && braceCount === 0) {
                    break;
                }
            }

            for (let i = functionStartLine + 1; i < Math.min(currentLine + 1, functionEndLine); i++) {
                const line = lines[i].trim();
                
                const varMatch = line.match(/^(let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::\s*([a-zA-Z_][a-zA-Z0-9_]*))?\s*=\s*(.+);?$/);
                if (varMatch) {
                    const varType = varMatch[1];
                    const varName = varMatch[2];
                    const explicitType = varMatch[3];
                    let value = varMatch[4];
                    let cleanValue = value.replace(/;\s*$/, '').trim();
                    let varDataType = explicitType;
                    if (!varDataType) {
                        varDataType = this.inferTypeFromValue(cleanValue);
                    }
                    variables.push({
                        name: varName,
                        type: varDataType,
                        scope: `local ${varType === 'let' ? 'variable' : 'FFI variable'}`,
                        value: cleanValue.length > 50 ? cleanValue.substring(0, 47) + '...' : cleanValue
                    });
                }
                
                const forMatch = line.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+/);
                if (forMatch) {
                    variables.push({
                        name: forMatch[1],
                        type: 'iterator',
                        scope: 'loop variable'
                    });
                }
            }
        }
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            const functionMatch = line.match(/^fn\s+/);
            if (functionMatch) {
                let braceCount = 0;
                let foundOpen = false;
                
                for (let j = i; j < lines.length; j++) {
                    const functionLine = lines[j];
                    for (let k = 0; k < functionLine.length; k++) {
                        if (functionLine[k] === '{') {
                            braceCount++;
                            foundOpen = true;
                        } else if (functionLine[k] === '}') {
                            braceCount--;
                            if (foundOpen && braceCount === 0) {
                                i = j;
                                break;
                            }
                        }
                    }
                    if (foundOpen && braceCount === 0) {
                        break;
                    }
                }
                continue;
            }

            const globalVarMatch = line.match(/^(let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::\s*([a-zA-Z_][a-zA-Z0-9_]*))?\s*=\s*(.+);?$/);
            if (globalVarMatch) {
                const varType = globalVarMatch[1];
                const varName = globalVarMatch[2];
                const explicitType = globalVarMatch[3];
                const value = globalVarMatch[4];
                
                let cleanValue = value.replace(/;\s*$/, '').trim();
                let varDataType = explicitType;
                if (!varDataType) {
                    varDataType = this.inferTypeFromValue(cleanValue);
                }
                variables.push({
                    name: varName,
                    type: varDataType,
                    scope: `global ${varType === 'let' ? 'variable' : 'FFI variable'}`,
                    value: cleanValue.length > 50 ? cleanValue.substring(0, 47) + '...' : cleanValue
                });
            }
        }

        return variables;
    }
    
    private inferTypeFromValue(value: string): string {
        value = value.trim();
        
        if (/^\d+$/.test(value)) {
            return 'i32';
        }
        
        if (/^\d+\.\d+$/.test(value)) {
            return 'f64';
        }
        
        if (value === 'true' || value === 'false') {
            return 'bool';
        }
        
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('`') && value.endsWith('`'))) {
            return 'string';
        }
        
        if (value.startsWith("'") && value.endsWith("'") && value.length === 3) {
            return 'char';
        }
        
        if (value === 'null') {
            return 'null';
        }
    
        return 'auto';
    }

private getAvailableStdModules(): Array<{name: string, description: string}> {
    const modules: Array<{name: string, description: string}> = [];
    
    try {
        const velangHome = path.join(os.homedir(), '.velang');
        const stdLibDir = path.join(velangHome, 'lib', 'std', 'src');
        
        if (fs.existsSync(stdLibDir)) {
            const files = fs.readdirSync(stdLibDir);
            
            for (const file of files) {
                if (file.endsWith('.ve')) {
                    const moduleName = `std/${file.replace('.ve', '')}`;
                    const filePath = path.join(stdLibDir, file);
                    
                    let description = `${file.replace('.ve', '')} module`;
                    try {
                        const content = fs.readFileSync(filePath, 'utf-8');
                        const lines = content.split('\n');
                        
                        for (const line of lines.slice(0, 5)) {
                            const trimmed = line.trim();
                            if (trimmed.startsWith('//') && trimmed.length > 3) {
                                description = trimmed.substring(2).trim();
                                break;
                            }
                        }
                    } catch (error) {
                    }
                    
                    modules.push({
                        name: moduleName,
                        description: description
                    });
                }
            }
        }
    } catch (error) {
        const fallbackModules = [
            { name: 'std/io', description: 'Input/output operations' },
            { name: 'std/math', description: 'Mathematical functions' },
            { name: 'std/string', description: 'String utilities' },
            { name: 'std/fs', description: 'File system operations' },
            { name: 'std/net', description: 'Network operations' },
            { name: 'std/collections', description: 'Data structures' },
            { name: 'std/time', description: 'Time and date operations' },
            { name: 'std/json', description: 'JSON parsing and serialization' },
            { name: 'std/http', description: 'HTTP client and server' },
            { name: 'std/crypto', description: 'Cryptographic functions' }
        ];
        modules.push(...fallbackModules);
    }
    
    return modules;
}

private getLocalModules(currentPath: string): Array<{name: string, description: string}> {
    const modules: Array<{name: string, description: string}> = [];
    
    if (!vscode.workspace.workspaceFolders) {
        return modules;
    }
    
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        
        const scanDir = (dir: string, relativePath: string = '') => {
            if (!fs.existsSync(dir)) return;
            
            const files = fs.readdirSync(dir);
            
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const relativeFilePath = relativePath ? path.join(relativePath, file) : file;
                
                if (fs.statSync(fullPath).isDirectory()) {
                    scanDir(fullPath, relativeFilePath);
                } else if (file.endsWith('.ve')) {
                    const moduleName = relativeFilePath.replace(/\\/g, '/').replace('.ve', '');
                    
                    if (moduleName !== path.basename(vscode.window.activeTextEditor?.document.fileName || '', '.ve')) {
                        let description = `Local module: ${moduleName}`;
                        
                        modules.push({
                            name: `./${moduleName}`,
                            description: description
                        });
                    }
                }
            }
        };
        
        scanDir(workspaceRoot);
    } catch (error) {
    }
    
    return modules;
}
}

class VeLangSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lineNumber = i;

            const functionMatch = line.match(/^fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (functionMatch) {
                const functionName = functionMatch[1];
                const startPos = new vscode.Position(lineNumber, 0);
                const endPos = this.findClosingBrace(lines, lineNumber);
                
                const symbol = new vscode.DocumentSymbol(
                    functionName,
                    functionName === 'main' ? 'Main function' : 'Function',
                    vscode.SymbolKind.Function,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, new vscode.Position(lineNumber, line.length))
                );

                this.parseFunctionBody(lines, lineNumber, endPos.line, symbol);
                symbols.push(symbol);
                continue;
            }

            const structMatch = line.match(/^struct\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
            if (structMatch) {
                const structName = structMatch[1];
                const startPos = new vscode.Position(lineNumber, 0);
                const endPos = this.findClosingBrace(lines, lineNumber);
                
                const symbol = new vscode.DocumentSymbol(
                    structName,
                    'Struct',
                    vscode.SymbolKind.Struct,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, new vscode.Position(lineNumber, line.length))
                );

                this.parseStructFields(lines, lineNumber + 1, endPos.line, symbol);
                symbols.push(symbol);
                continue;
            }

            const enumMatch = line.match(/^enum\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
            if (enumMatch) {
                const enumName = enumMatch[1];
                const startPos = new vscode.Position(lineNumber, 0);
                const endPos = this.findClosingBrace(lines, lineNumber);
                
                const symbol = new vscode.DocumentSymbol(
                    enumName,
                    'Enum',
                    vscode.SymbolKind.Enum,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, new vscode.Position(lineNumber, line.length))
                );

                this.parseEnumVariants(lines, lineNumber + 1, endPos.line, symbol);
                symbols.push(symbol);
                continue;
            }

            const varMatch = line.match(/^(let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
            if (varMatch) {
                const varName = varMatch[2];
                const varType = varMatch[1];
                const startPos = new vscode.Position(lineNumber, 0);
                const endPos = new vscode.Position(lineNumber, line.length);
                const symbol = new vscode.DocumentSymbol(
                    varName,
                    varType === 'let' ? 'Variable' : 'FFI Variable',
                    vscode.SymbolKind.Variable,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, endPos)
                );
                symbols.push(symbol);
            }
        }

        return symbols;
    }

    private findClosingBrace(lines: string[], startLine: number): vscode.Position {
        let braceCount = 0;
        let foundOpen = false;

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            for (let j = 0; j < line.length; j++) {
                if (line[j] === '{') {
                    braceCount++;
                    foundOpen = true;
                } else if (line[j] === '}') {
                    braceCount--;
                    if (foundOpen && braceCount === 0) {
                        return new vscode.Position(i, j);
                    }
                }
            }
        }
        return new vscode.Position(startLine, 0);
    }

    private parseFunctionBody(lines: string[], startLine: number, endLine: number, parentSymbol: vscode.DocumentSymbol) {
        for (let i = startLine + 1; i < endLine; i++) {
            const line = lines[i].trim();
            
            const varMatch = line.match(/^(let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
            if (varMatch) {
                const varName = varMatch[2];
                const varType = varMatch[1];
                const startPos = new vscode.Position(i, 0);
                const endPos = new vscode.Position(i, line.length);

                const symbol = new vscode.DocumentSymbol(
                    varName,
                    `Local ${varType === 'let' ? 'variable' : 'FFI variable'}`,
                    vscode.SymbolKind.Variable,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, endPos)
                );
                parentSymbol.children.push(symbol);
            }
        }
    }

    private parseStructFields(lines: string[], startLine: number, endLine: number, parentSymbol: vscode.DocumentSymbol) {
        for (let i = startLine; i < endLine; i++) {
            const line = lines[i].trim();
            
            const fieldMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (fieldMatch) {
                const fieldName = fieldMatch[1];
                const fieldType = fieldMatch[2];
                const startPos = new vscode.Position(i, 0);
                const endPos = new vscode.Position(i, line.length);
                
                const symbol = new vscode.DocumentSymbol(
                    fieldName,
                    `Field (${fieldType})`,
                    vscode.SymbolKind.Field,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, endPos)
                );
                parentSymbol.children.push(symbol);
            }
        }
    }

    private parseEnumVariants(lines: string[], startLine: number, endLine: number, parentSymbol: vscode.DocumentSymbol) {
        for (let i = startLine; i < endLine; i++) {
            const line = lines[i].trim();
            
            const variantMatch = line.match(/^([A-Z][a-zA-Z0-9_]*)/);
            if (variantMatch) {
                const variantName = variantMatch[1];
                const startPos = new vscode.Position(i, 0);
                const endPos = new vscode.Position(i, line.length);
                
                const symbol = new vscode.DocumentSymbol(
                    variantName,
                    'Enum variant',
                    vscode.SymbolKind.EnumMember,
                    new vscode.Range(startPos, endPos),
                    new vscode.Range(startPos, endPos)
                );
                parentSymbol.children.push(symbol);
            }
        }
    }
}

export function deactivate() {
}
