import type { ChildProcess } from "node:child_process";

export async function stopChrome(proc: ChildProcess): Promise<void> {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;

  await new Promise<void>(resolve => {
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(force);

      if (fallback) clearTimeout(fallback);

      proc.off("exit", finish);
      resolve();
    };

    const force = setTimeout(() => {
      proc.kill("SIGKILL");
      fallback = setTimeout(finish, 1000);
    }, 2000);

    proc.once("exit", finish);
    proc.kill("SIGTERM");
  });
}
