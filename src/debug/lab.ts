/** Test hooks for headless runs (Playwright) and console debugging, as in the prototype. */
export function installLab(hooks: Record<string, unknown>) {
  (window as unknown as { __lab: Record<string, unknown> }).__lab = hooks;
}
