import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type TokenSource = 'keychain' | 'file' | 'none';

export interface TokenResult {
  token: string | null;
  source: TokenSource;
  error?: string;
}

interface CredentialJson {
  claudeAiOauth?: { accessToken?: string };
}

function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as CredentialJson;
    return parsed.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function tryKeychain(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, encoding: 'utf8' }
    );
    return extractToken(out);
  } catch {
    return null;
  }
}

function tryFile(): string | null {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    return extractToken(fs.readFileSync(credPath, 'utf8'));
  } catch {
    return null;
  }
}

export function getToken(): TokenResult {
  const fromKeychain = tryKeychain();
  if (fromKeychain) return { token: fromKeychain, source: 'keychain' };

  const fromFile = tryFile();
  if (fromFile) return { token: fromFile, source: 'file' };

  return {
    token: null,
    source: 'none',
    error: 'No Claude Code credentials found. Run `claude` to log in first.',
  };
}
