/**
 * Imported first by every process entry point. Outside sandbox mode it does
 * nothing. In sandbox mode it blocks outbound traffic before any client
 * library loads, and stops the process if the configuration could let a call
 * or message reach a real service.
 */
import { applySandboxDefaults, installOutboundBlock, isSandboxMode, sandboxConfigProblems } from './sandboxMode.js';

if (isSandboxMode()) {
  installOutboundBlock();
  applySandboxDefaults();
  const problems = sandboxConfigProblems();
  if (problems.length > 0) {
    console.error('[sandbox] refusing to start:', problems.join('; '));
    process.exit(1);
  }
  console.warn('[sandbox] SANDBOX_MODE active: outbound traffic is limited to this process');
}
