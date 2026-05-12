import fs from 'node:fs';
import path from 'node:path';
const DEFAULT_MAX_OUTPUT_BYTES = 16_000;
const SCRIPT_FILE_MODE = 0o600;
const PTY_RUNNER_MODE = 0o700;
export function materializeTerminalOutput(request, output) {
    const max = request.manifest.execution.maxOutputBytes;
    const artifacts = [];
    const stdoutArtifact = materializeStreamArtifact(request, 'stdout', output.stdout, max);
    const stderrArtifact = materializeStreamArtifact(request, 'stderr', output.stderr, max);
    if (stdoutArtifact) {
        artifacts.push(stdoutArtifact);
    }
    if (stderrArtifact) {
        artifacts.push(stderrArtifact);
    }
    return {
        stdout: truncate(output.stdout, max),
        stderr: truncate(output.stderr, max),
        stdoutTruncated: output.stdout.length > max,
        stderrTruncated: output.stderr.length > max,
        artifacts,
    };
}
export function materializeScriptArtifact(request, script, scriptHash) {
    const normalizedScript = script.endsWith('\n') ? script : `${script}\n`;
    const relativePath = `artifacts/tools/${request.context.callId}/script-${scriptHash.slice(0, 12)}.sh`;
    const absolutePath = writeArtifact(request, relativePath, normalizedScript, SCRIPT_FILE_MODE);
    return {
        id: `${request.context.callId}:script`,
        kind: 'file',
        uri: toFileUri(absolutePath),
        mimeType: 'text/x-shellscript; charset=utf-8',
        sizeBytes: Buffer.byteLength(normalizedScript, 'utf8'),
    };
}
export function materializePtyRunnerArtifact(request) {
    const relativePath = `artifacts/tools/${request.context.callId}/pty-runner.py`;
    const absolutePath = writeArtifact(request, relativePath, PTY_RUNNER_SOURCE, PTY_RUNNER_MODE);
    return {
        id: `${request.context.callId}:pty-runner`,
        kind: 'file',
        uri: toFileUri(absolutePath),
        mimeType: 'text/x-python; charset=utf-8',
        sizeBytes: Buffer.byteLength(PTY_RUNNER_SOURCE, 'utf8'),
    };
}
export function fileUriToPath(uri) {
    if (!uri.startsWith('file://')) {
        throw new Error(`Expected file artifact uri, got ${uri}`);
    }
    return uri.slice('file://'.length);
}
function materializeStreamArtifact(request, kind, content, maxInlineBytes) {
    if (!content || content.length <= maxInlineBytes) {
        return null;
    }
    const relativePath = `artifacts/tools/${request.context.callId}/${kind}.txt`;
    const absolutePath = writeArtifact(request, relativePath, content);
    return {
        id: `${request.context.callId}:${kind}`,
        kind,
        uri: toFileUri(absolutePath),
        mimeType: 'text/plain; charset=utf-8',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
}
function writeArtifact(request, relativePath, content, mode) {
    const writeZone = getWriteZone(request);
    return writeZone
        ? writeWithZone(writeZone, relativePath, content, mode)
        : writeLocalArtifact(request.context.dataRoot ||
            request.context.runtime?.dataRoot ||
            request.context.projectRoot, relativePath, content, mode);
}
function getWriteZone(request) {
    try {
        const candidate = request.context.services.get('writeZone');
        if (candidate &&
            typeof candidate === 'object' &&
            typeof candidate.runtime === 'function' &&
            typeof candidate.writeFile === 'function') {
            return candidate;
        }
    }
    catch {
        return null;
    }
    return null;
}
function writeWithZone(writeZone, relativePath, content, mode) {
    const target = writeZone.runtime(relativePath);
    writeZone.writeFile(target, content);
    if (mode !== undefined) {
        try {
            fs.chmodSync(target.absolute, mode);
        }
        catch {
            // Best-effort permission tightening for script artifacts.
        }
    }
    return target.absolute;
}
function writeLocalArtifact(dataRoot, relativePath, content, mode) {
    const absolutePath = path.join(dataRoot, '.asd', relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, { encoding: 'utf8', mode });
    return absolutePath;
}
function truncate(value, max = DEFAULT_MAX_OUTPUT_BYTES) {
    if (value.length <= max) {
        return value;
    }
    return `${value.slice(0, max)}\n\n... [output truncated, ${value.length} chars total]`;
}
function toFileUri(absolutePath) {
    return `file://${absolutePath}`;
}
const PTY_RUNNER_SOURCE = `#!/usr/bin/env python3
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:
        pass


def drain(fd):
    while True:
        try:
            ready, _, _ = select.select([fd], [], [], 0)
            if fd not in ready:
                return
            data = os.read(fd, 4096)
            if not data:
                return
            os.write(sys.stdout.fileno(), data)
        except OSError:
            return


def relay_stdin_once(fd):
    stdin_fd = sys.stdin.fileno()
    try:
        while True:
            ready, _, _ = select.select([stdin_fd], [], [], 0)
            if stdin_fd not in ready:
                return False
            data = os.read(stdin_fd, 4096)
            if not data:
                try:
                    os.write(fd, b"\\x04")
                except OSError:
                    pass
                return True
            os.write(fd, data)
    except OSError:
        return True


def main():
    shell = sys.argv[1]
    command = sys.argv[2]
    rows = int(sys.argv[3])
    cols = int(sys.argv[4])
    stdin_mode = sys.argv[5] if len(sys.argv) > 5 else "disabled"
    pid, fd = pty.fork()
    if pid == 0:
        set_winsize(0, rows, cols)
        os.execl(shell, shell, "-lc", command)

    set_winsize(fd, rows, cols)

    def terminate_child(_signum, _frame):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        sys.exit(124)

    signal.signal(signal.SIGTERM, terminate_child)
    signal.signal(signal.SIGINT, terminate_child)

    while True:
        if stdin_mode == "provided":
            if relay_stdin_once(fd):
                stdin_mode = "disabled"

        try:
            ready, _, _ = select.select([fd], [], [], 0.1)
            if fd in ready:
                data = os.read(fd, 4096)
                if data:
                    os.write(sys.stdout.fileno(), data)
        except OSError:
            break

        try:
            done_pid, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if done_pid == pid:
            drain(fd)
            if os.WIFEXITED(status):
                sys.exit(os.WEXITSTATUS(status))
            if os.WIFSIGNALED(status):
                sys.exit(128 + os.WTERMSIG(status))
            sys.exit(1)


if __name__ == "__main__":
    main()
`;
