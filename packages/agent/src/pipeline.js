/** The 9 steps this product exists to demonstrate. */
export const PIPELINE_STEPS = [
  {
    id: 'run_app',
    title: 'Run the app',
    detail: 'Install deps and start the project (or use a URL you already run).',
  },
  {
    id: 'console',
    title: 'Read browser console',
    detail: 'Capture console errors and warnings in headless Chromium.',
  },
  {
    id: 'network',
    title: 'Read network logs',
    detail: 'Record failed requests and HTTP 4xx/5xx responses.',
  },
  {
    id: 'git_history',
    title: 'Read Git history',
    detail: 'Inspect recent commits for context around the failure.',
  },
  {
    id: 'root_cause',
    title: 'Find the root cause',
    detail: 'Combine live evidence + code search into a diagnosis.',
  },
  {
    id: 'suggest_fix',
    title: 'Suggest a fix',
    detail: 'Propose file changes (or a clear report when unsure).',
  },
  {
    id: 'apply_branch',
    title: 'Apply fix on a branch',
    detail: 'Never push to main — write to tracefix/fix-<id>.',
  },
  {
    id: 'run_tests',
    title: 'Run tests',
    detail: 'Execute the project test script when available.',
  },
  {
    id: 'confirm',
    title: 'Confirm resolved',
    detail: 'Re-open the app and compare before/after error signals.',
  },
];
