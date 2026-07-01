import { runAuth } from './auth.mjs';

export async function runSupervisor(args) {
  return runAuth({ ...args, command: 'supervisor' });
}
