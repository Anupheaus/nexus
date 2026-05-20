// On Windows with NVM, process.execPath resolves to a junction point at
// C:\Program Files\nodejs\node.exe that Windows CreateProcess cannot follow,
// causing child_process.fork() to fail with ENOENT. Override to use the bare
// 'node' command so the OS resolves it via PATH instead.
export function setup() {
  if (process.platform === 'win32') {
    process.execPath = 'node';
  }
}
