import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type TokenSource = 'keychain' | 'wincred' | 'file' | 'none';

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

const WIN_CRED_TARGET = 'Claude Code-credentials';
const WIN_PS_SCRIPT = `$ErrorActionPreference='Stop';try{$src=@'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CcuCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct CRED {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public uint BlobSize;
    public IntPtr Blob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  private static extern bool CredRead(string target, int type, int flag, out IntPtr cred);
  [DllImport("advapi32.dll", SetLastError=true)]
  private static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      var c = (CRED)Marshal.PtrToStructure(p, typeof(CRED));
      if (c.BlobSize == 0 || c.Blob == IntPtr.Zero) return null;
      byte[] buf = new byte[c.BlobSize];
      Marshal.Copy(c.Blob, buf, 0, (int)c.BlobSize);
      return Encoding.Unicode.GetString(buf);
    } finally {
      CredFree(p);
    }
  }
}
'@;Add-Type -TypeDefinition $src -Language CSharp | Out-Null;$v=[CcuCred]::Read('${WIN_CRED_TARGET}');if($v){[Console]::Out.Write($v)}}catch{exit 1}`;

function tryWinCredentialManager(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_SCRIPT],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, encoding: 'utf8', windowsHide: true }
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
  // OS-native credential store first, JSON file fallback. The file may be a
  // stale copy left from an older login flow, so checking the keystore first
  // avoids serving a token Claude Code has already rotated.
  const fromKeychain = tryKeychain();
  if (fromKeychain) return { token: fromKeychain, source: 'keychain' };

  const fromWinCred = tryWinCredentialManager();
  if (fromWinCred) return { token: fromWinCred, source: 'wincred' };

  const fromFile = tryFile();
  if (fromFile) return { token: fromFile, source: 'file' };

  return {
    token: null,
    source: 'none',
    error: 'No Claude Code credentials found. Run `claude` to log in first.',
  };
}
