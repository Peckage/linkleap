import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '../../../');
  try {
    await runTests({
      // Set VSCODE_PATH to test against an installed VS Code instead of downloading one.
      vscodeExecutablePath: process.env.VSCODE_PATH || undefined,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, './suite/index'),
      launchArgs: [path.join(root, 'test-fixtures/workspace'), '--disable-extensions', '--disable-workspace-trust'],
    });
  } catch (err) {
    console.error('Integration tests failed', err);
    process.exit(1);
  }
}

void main();
